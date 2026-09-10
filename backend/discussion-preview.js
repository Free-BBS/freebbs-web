const { marked, Parser, TextRenderer } = require('marked');
const { parseReference } = require('../public/circuit-embeds');

const MAX_MARKDOWN_LENGTH = 20000;
const MAX_IMAGE_URL_LENGTH = 4096;
const textRenderer = new TextRenderer();
const htmlEntities = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  colon: ':',
  Tab: '\t',
  NewLine: '\n',
  nbsp: ' ',
};

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] !== '#') return htmlEntities[name] ?? entity;
    const isHex = name[1].toLowerCase() === 'x';
    const point = Number.parseInt(name.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : '\ufffd';
  });
}

function imageUrl(value, origin) {
  if (!value || value.length > MAX_IMAGE_URL_LENGTH) return null;
  const decoded = decodeEntities(value).trim();
  // Unknown entities and control characters must not disguise a URL's scheme.
  // eslint-disable-next-line no-control-regex -- reject URL control characters before parsing
  if (!decoded || /[\x00-\x1f\x7f]|&(?:#\w+|[a-z]+);/i.test(decoded)) return null;
  try {
    const url = new URL(decoded, origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Keep local uploads relative so the frontend can map them to its API host.
    if (url.origin === new URL(origin).origin && !url.pathname.startsWith('//')) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.href;
  } catch {
    return null;
  }
}

function imageAlt(token) {
  const value = token.tokens
    ? Parser.parseInline(token.tokens, { renderer: textRenderer })
    : token.text || '';
  return decodeEntities(value.replace(/<[^>]*>/g, '')).slice(0, 300);
}

function firstPreview(tokens, origin) {
  let inRawHtml = false;
  for (const token of tokens) {
    if (token.type === 'html') {
      inRawHtml = Boolean(token.inRawBlock);
      continue;
    }
    if (inRawHtml || token.type === 'code' || token.type === 'codespan') continue;

    if (token.type === 'image') {
      const url = imageUrl(token.href, origin);
      if (url) return { type: 'image', url, alt: imageAlt(token) };
      // An image's alt-text tokens are not separate rendered images.
      continue;
    }
    if (token.type === 'link') {
      const reference = parseReference(decodeEntities(token.href), origin);
      if (reference) return { type: 'circuit', ...reference };
    }

    let children = token.tokens || [];
    if (token.type === 'list') children = token.items;
    if (token.type === 'table') children = [...token.header, ...token.rows.flat()];
    const preview = firstPreview(children, origin);
    if (preview) return preview;
  }
  return null;
}

function getDiscussionPreview(markdown, origin) {
  if (typeof markdown !== 'string' || !markdown) return null;
  try {
    return firstPreview(
      marked.lexer(markdown.slice(0, MAX_MARKDOWN_LENGTH), { gfm: true }),
      origin,
    );
  } catch {
    return null;
  }
}

module.exports = { getDiscussionPreview };
