/* Shared validation: artifacts are drafts, never published or executed by chat. */
(function artifactDataModule(root) {
  function normalize(value) {
    if (!value || typeof value !== 'object') throw new Error('生成内容无效。');
    const title = String(value.title || 'Max 生成的作品').slice(0, 120);
    if (value.kind === 'tool') {
      if (typeof value.html !== 'string' || !value.html.trim() || value.html.length > 180000)
        throw new Error('HTML 内容为空或超过长度限制。');
      return { kind: 'tool', title, html: value.html };
    }
    if (value.kind === 'circuit') {
      if (JSON.stringify(value.document).length > 256000) throw new Error('电路过大。');
      const protocol =
        typeof module !== 'undefined' && module.exports
          ? require('./circuit-ai-actions')
          : root.CircuitAIActions;
      return { kind: 'circuit', title, document: protocol.validateEditorDocument(value.document) };
    }
    throw new Error('不支持的作品类型。');
  }
  const api = { normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsMaxArtifactData = api;
})(typeof window !== 'undefined' ? window : globalThis);
