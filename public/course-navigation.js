/* Public course navigation context only: no storage, identity, progress or assessment writes. */
(function expose(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsCourseNavigation = api;
})(typeof window === 'undefined' ? globalThis : window, (root) => {
  const FIELDS = [
    'course',
    'focus',
    'chapter',
    'find',
    'findPage',
    'pickerChapter',
    'pickerQuery',
    'pickerPage',
    'routePage',
    'catalogChapter',
    'catalogQuery',
    'catalogPage',
    'catalogOpen',
  ];
  const MAX_URL_LENGTH = 8192;
  const pages = new Set(['findPage', 'pickerPage', 'routePage', 'catalogPage']);
  const queries = new Set(['find', 'pickerQuery', 'catalogQuery']);
  const hasControls = (value) =>
    Array.from(value).some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127;
    });
  const validCourse = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value);
  function normalize(input, courseSlug) {
    if (!validCourse(courseSlug)) return null;
    const values = new Map();
    const seen = new Set();
    for (const [key, value] of input) {
      if (!FIELDS.includes(key) || seen.has(key)) return null;
      seen.add(key);
      if (typeof value !== 'string' || hasControls(value)) return null;
      if (key === 'course') {
        if (value !== courseSlug) return null;
        values.set(key, value);
      } else if (queries.has(key)) {
        if (Array.from(value).length > 200) return null;
        if (value) values.set(key, value);
      } else if (pages.has(key)) {
        if (!/^(?:0|[1-9]\d{0,4})$/.test(value) || Number(value) > 10000) return null;
        values.set(key, value);
      } else if (key === 'catalogOpen') {
        if (!/^[01]$/.test(value)) return null;
        values.set(key, value);
      } else if (value) {
        if (value.length > 64) return null;
        const pattern =
          key === 'focus' ? /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/ : /^[A-Z][A-Z0-9]*-[A-Z0-9]+$/;
        if (!pattern.test(value)) return null;
        values.set(key, value);
      }
    }
    if (values.get('course') !== courseSlug) return null;
    return new URLSearchParams(
      FIELDS.filter((key) => values.has(key)).map((key) => [key, values.get(key)]),
    );
  }
  function parse(value, courseSlug) {
    if (
      typeof value !== 'string' ||
      value.length > MAX_URL_LENGTH ||
      !/^\/course(?:\?|$)/.test(value) ||
      value.includes('#') ||
      hasControls(value)
    )
      return null;
    const query = value.slice('/course'.length);
    // Never decode the path, reinterpret a returnTo as a full URL, or decode
    // a second time. Escaped text inside a search remains search text.
    return normalize(new URLSearchParams(query.startsWith('?') ? query.slice(1) : ''), courseSlug);
  }
  function encode(value, courseSlug) {
    let normalized;
    if (typeof value === 'string') normalized = parse(value, courseSlug);
    else if (value instanceof URLSearchParams) normalized = normalize(value, courseSlug);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const pairs = [];
      for (const key of FIELDS) {
        if (
          !Object.prototype.hasOwnProperty.call(value, key) ||
          value[key] === undefined ||
          value[key] === null
        )
          continue;
        if (!['string', 'number'].includes(typeof value[key])) return '';
        pairs.push([key, String(value[key])]);
      }
      normalized = normalize(pairs, courseSlug);
    }
    if (!normalized) return '';
    const result = `/course?${normalized}`;
    return result.length <= MAX_URL_LENGTH ? result : '';
  }
  function remember(value, courseSlug, environment = root) {
    const context = parse(value, courseSlug);
    if (!context || !environment?.history?.replaceState || !environment?.location?.href)
      return false;
    try {
      const current = new URL(environment.location.href);
      if (current.pathname !== '/course' || current.searchParams.get('course') !== courseSlug)
        return false;
      // Keep unrelated view preferences and the existing history state. Replace,
      // never push, so native Back still takes exactly one step from the reader.
      for (const key of FIELDS) current.searchParams.delete(key);
      for (const [key, entry] of context) current.searchParams.set(key, entry);
      const relative = `${current.pathname}${current.search}${current.hash}`;
      if (relative.length > MAX_URL_LENGTH) return false;
      environment.history.replaceState(environment.history.state, '', relative);
      return true;
    } catch {
      // A history restriction must not prevent opening the learning material.
      return false;
    }
  }
  return { FIELDS, MAX_URL_LENGTH, encode, parse, remember };
});
