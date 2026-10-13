/* Bounded browsing of an existing chapter; no inferred nodes or learning order. */
(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsCourseDirectory = api;
})(typeof window === 'undefined' ? null : window, () => {
  const PAGE_SIZE = 12;
  const normalize = (value) =>
    String(value || '')
      .normalize('NFKC')
      .trim()
      .toLowerCase();
  function page(nodes, query = '', requestedPage = 0) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    const matches = nodes.filter((node) => {
      const text = normalize([node.id, node.title].join(' '));
      return terms.every((term) => text.includes(term));
    });
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const current = Math.min(
      pageCount - 1,
      Math.max(0, Number.isInteger(requestedPage) ? requestedPage : 0),
    );
    const offset = current * PAGE_SIZE;
    const selected = matches.slice(offset, offset + PAGE_SIZE);
    return {
      nodes: selected,
      page: current,
      pageCount,
      total: matches.length,
      start: matches.length ? offset + 1 : 0,
      end: offset + selected.length,
    };
  }
  return { PAGE_SIZE, page };
});
