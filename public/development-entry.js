(function exposeDevelopmentEntry(root) {
  function enterDevelopment({ navigate, search = '', hash = '' }) {
    navigate(`/development/${search}${hash}`);
  }

  if (typeof window !== 'undefined') {
    enterDevelopment({
      navigate: (url) => window.location.replace(url),
      search: window.location.search,
      hash: window.location.hash,
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { enterDevelopment };
  } else {
    Reflect.set(root, 'enterDevelopment', enterDevelopment);
  }
})(typeof globalThis === 'undefined' ? this : globalThis);
