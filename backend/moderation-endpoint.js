const https = require('node:https');
const dns = require('node:dns').promises;
const { isIP } = require('node:net');
const { Readable } = require('node:stream');
const { normalizeModerationBaseUrl, isPublicAddress } = require('./moderation-settings');

// Resolve and validate inside the socket's lookup callback. The connection uses
// these exact addresses, rather than resolving again after an SSRF pre-check.
function createModerationFetch({ lookup = dns.lookup, request = https.request } = {}) {
  return async function moderationFetch(url, init = {}) {
    const endpoint = new URL(normalizeModerationBaseUrl(url));
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname) && !isPublicAddress(hostname))
      throw new Error('审核 API 必须使用公网 HTTPS 地址。');
    if (init.method !== 'POST' || init.redirect !== 'error')
      throw new Error('审核 API 请求格式无效。');
    return new Promise((resolve, reject) => {
      const outgoing = request(
        endpoint,
        {
          method: 'POST',
          headers: init.headers,
          signal: init.signal,
          // No pooled connection can bypass this request's DNS validation.
          agent: false,
          lookup(name, options, callback) {
            Promise.resolve()
              .then(() => lookup(name, { all: true, verbatim: true }))
              .then((addresses) => {
                if (
                  !Array.isArray(addresses) ||
                  !addresses.length ||
                  addresses.some(({ address }) => !isPublicAddress(address))
                )
                  throw new Error('审核 API 域名必须解析到公网地址。');
                const available = options.family
                  ? addresses.filter(({ family }) => family === options.family)
                  : addresses;
                if (!available.length) throw new Error('审核 API 域名解析失败。');
                if (options.all) callback(null, available);
                else callback(null, available[0].address, available[0].family);
              })
              .catch((error) => callback(error));
          },
        },
        (incoming) => {
          // Native HTTPS never follows redirects, including redirects that
          // would forward the credential or private moderation material.
          if (incoming.statusCode >= 300 && incoming.statusCode < 400) {
            incoming.destroy();
            reject(new Error('审核 API 不允许重定向。'));
            return;
          }
          resolve({
            ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
            status: incoming.statusCode,
            url: endpoint.href,
            redirected: false,
            headers: new Headers(
              Object.entries(incoming.headers).flatMap(([name, value]) =>
                (Array.isArray(value) ? value : [value])
                  .filter((item) => item !== undefined)
                  .map((item) => [name, String(item)]),
              ),
            ),
            body: Readable.toWeb(incoming),
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(init.body);
    });
  };
}

module.exports = { createModerationFetch, moderationFetch: createModerationFetch() };
