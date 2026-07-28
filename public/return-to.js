(function attachReturnTo(factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.FreeBBSReturnTo = api;
  }
})(() => {
  const fallback = '/';

  function defaultOrigin() {
    return typeof window !== 'undefined' && window.location ? window.location.origin : '';
  }

  function containsControlCharacter(value) {
    return Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127;
    });
  }

  function sanitizeReturnTo(value, origin = defaultOrigin()) {
    if (
      typeof value !== 'string' ||
      !value.startsWith('/') ||
      value.startsWith('//') ||
      value.includes('\\') ||
      /%5c/i.test(value) ||
      containsControlCharacter(value)
    ) {
      return fallback;
    }

    try {
      decodeURI(value);
      const trustedOrigin = new URL(origin);
      if (!['http:', 'https:'].includes(trustedOrigin.protocol)) {
        return fallback;
      }
      const target = new URL(value, trustedOrigin);
      if (
        target.origin !== trustedOrigin.origin ||
        target.pathname.startsWith('//') ||
        target.pathname.includes('\\')
      ) {
        return fallback;
      }
      return `${target.pathname}${target.search}${target.hash}`;
    } catch {
      return fallback;
    }
  }

  function decodeQueryComponent(value) {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  }

  function readReturnTo(
    search = typeof window !== 'undefined' ? window.location.search : '',
    origin = defaultOrigin(),
  ) {
    if (typeof search !== 'string') {
      return fallback;
    }

    const query = search.startsWith('?') ? search.slice(1) : search;
    for (const field of query.split('&')) {
      if (!field) {
        continue;
      }
      const separator = field.indexOf('=');
      const rawKey = separator === -1 ? field : field.slice(0, separator);
      const rawValue = separator === -1 ? '' : field.slice(separator + 1);
      try {
        if (decodeQueryComponent(rawKey) === 'returnTo') {
          return sanitizeReturnTo(decodeQueryComponent(rawValue), origin);
        }
      } catch {
        return fallback;
      }
    }

    return fallback;
  }

  return { readReturnTo, sanitizeReturnTo };
});
