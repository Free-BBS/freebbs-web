/* Read-only chapter route model: published order is not a lock or a mastery judgment. */
(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsLearningRoute = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const validId = (id) =>
    typeof id === 'string' &&
    id.length >= 4 &&
    id.length <= 64 &&
    /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(id);
  const chapterOf = (id) =>
    String(id || '')
      .split('-')
      .slice(0, 2)
      .join('-');
  const chapterNode = (id) => /^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(id);

  function directedStages(nodes, edges) {
    const forward = new Map(nodes.map((node) => [node.id, []]));
    const reverse = new Map(nodes.map((node) => [node.id, []]));
    const participating = new Set();
    for (const edge of edges) {
      forward.get(edge.source).push(edge.target);
      reverse.get(edge.target).push(edge.source);
      participating.add(edge.source);
      participating.add(edge.target);
    }
    const visited = new Set();
    const finish = [];
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const stack = [{ id: node.id, index: 0 }];
      while (stack.length) {
        const current = stack.at(-1);
        const targets = forward.get(current.id);
        if (current.index < targets.length) {
          const target = targets[current.index];
          current.index += 1;
          if (!visited.has(target)) {
            visited.add(target);
            stack.push({ id: target, index: 0 });
          }
        } else {
          finish.push(current.id);
          stack.pop();
        }
      }
    }
    const components = [];
    const membership = new Map();
    for (const id of finish.reverse()) {
      if (membership.has(id)) continue;
      const index = components.length;
      const members = [];
      const stack = [id];
      membership.set(id, index);
      while (stack.length) {
        const current = stack.pop();
        members.push(current);
        for (const source of reverse.get(current))
          if (!membership.has(source)) {
            membership.set(source, index);
            stack.push(source);
          }
      }
      components.push(members);
    }
    const successors = components.map(() => new Set());
    const indegrees = components.map(() => 0);
    const ranks = components.map(() => 0);
    for (const edge of edges) {
      const source = membership.get(edge.source);
      const target = membership.get(edge.target);
      if (source !== target && !successors[source].has(target)) {
        successors[source].add(target);
        indegrees[target] += 1;
      }
    }
    const ready = indegrees.flatMap((degree, index) => (degree === 0 ? [index] : []));
    for (let cursor = 0; cursor < ready.length; cursor += 1) {
      const source = ready[cursor];
      for (const target of successors[source]) {
        ranks[target] = Math.max(ranks[target], ranks[source] + 1);
        indegrees[target] -= 1;
        if (!indegrees[target]) ready.push(target);
      }
    }
    const last = Math.max(0, ...ranks);
    const cyclic = new Set(components.filter((group) => group.length > 1).flat());
    for (const edge of edges) if (edge.source === edge.target) cyclic.add(edge.source);
    return new Map(
      nodes.map((node) => [
        node.id,
        {
          index: participating.has(node.id) ? ranks[membership.get(node.id)] : last + 1,
          independent: !participating.has(node.id),
          cycle: cyclic.has(node.id),
        },
      ]),
    );
  }

  function buildRoute(rawNodes = [], rawEdges = [], options = {}) {
    const settings = options && typeof options === 'object' ? options : {};
    const chapterId =
      typeof settings.chapterId === 'string' &&
      /^[A-Z][A-Z0-9]*-[A-Z0-9]+$/.test(settings.chapterId)
        ? settings.chapterId
        : '';
    const size = Number(settings.pageSize);
    const pageSize = Number.isSafeInteger(size) && size > 0 ? Math.min(12, size) : 6;
    const byId = new Map();
    for (const node of Array.isArray(rawNodes) ? rawNodes : [])
      if (node && validId(node.id) && !chapterNode(node.id) && !byId.has(node.id))
        byId.set(node.id, node);
    const nodes = [...byId.values()].filter(
      (node) => chapterId && chapterOf(node.id) === chapterId,
    );
    const local = new Set(nodes.map((node) => node.id));
    const validEdges = (Array.isArray(rawEdges) ? rawEdges : []).filter(
      (edge) =>
        edge &&
        ['ordered', 'related'].includes(edge.type) &&
        byId.has(edge.source) &&
        byId.has(edge.target),
    );
    const ordered = validEdges.filter(
      (edge) => edge.type === 'ordered' && local.has(edge.source) && local.has(edge.target),
    );
    const kind = ordered.length ? 'ordered' : 'directory';
    const label = kind === 'ordered' ? '已发布学习顺序' : '章节目录顺序';
    const stagesById = kind === 'ordered' ? directedStages(nodes, ordered) : new Map();
    const directoryIndex = new Map(nodes.map((node, index) => [node.id, index]));
    const sequence =
      kind === 'ordered'
        ? [...nodes].sort(
            (a, b) =>
              stagesById.get(a.id).index - stagesById.get(b.id).index ||
              directoryIndex.get(a.id) - directoryIndex.get(b.id),
          )
        : nodes;
    const total = sequence.length;
    const pageCount = Math.ceil(total / pageSize);
    const positions = new Map(sequence.map((node, index) => [node.id, index]));
    const selected = local.has(settings.selectedNodeId) ? settings.selectedNodeId : '';
    const resume = local.has(settings.resumeNodeId) ? settings.resumeNodeId : '';
    const entryId = selected || resume || sequence[0]?.id || '';
    let entry = null;
    if (entryId)
      entry = {
        nodeId: entryId,
        kind: selected ? 'selected' : resume ? 'continue' : 'start',
        page: Math.floor(positions.get(entryId) / pageSize),
      };
    const explicitPage =
      Object.prototype.hasOwnProperty.call(settings, 'page') &&
      Number.isSafeInteger(settings.page) &&
      settings.page >= 0;
    const currentPage = Math.min(
      Math.max(0, pageCount - 1),
      explicitPage ? settings.page : entry?.page || 0,
    );
    const offset = currentPage * pageSize;
    const incoming = new Map(nodes.map((node) => [node.id, []]));
    const outgoing = new Map(nodes.map((node) => [node.id, []]));
    const relations = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of ordered) {
      incoming.get(edge.target).push(edge);
      outgoing.get(edge.source).push(edge);
    }
    for (const edge of validEdges) {
      relations.get(edge.source)?.push(edge);
      if (edge.target !== edge.source) relations.get(edge.target)?.push(edge);
    }
    const steps = sequence.slice(offset, offset + pageSize).map((node, index) => {
      const stage = stagesById.get(node.id);
      const actualSources = [...new Set(incoming.get(node.id).map((edge) => edge.source))];
      const actualTargets = [...new Set(outgoing.get(node.id).map((edge) => edge.target))];
      const inputCount = actualSources.filter((id) => id !== node.id).length;
      const outputCount = actualTargets.filter((id) => id !== node.id).length;
      return {
        id: node.id,
        node,
        index: offset + index,
        stage: stage?.index || 0,
        kind: kind === 'directory' ? 'directory' : stage.independent ? 'independent' : 'ordered',
        selected: node.id === selected,
        resume: node.id === resume,
        entry: node.id === entryId,
        locked: false,
        incoming: incoming.get(node.id),
        outgoing: outgoing.get(node.id),
        actualSources,
        actualTargets,
        relations: relations.get(node.id),
        branch: {
          incoming: inputCount,
          outgoing: outputCount,
          merge: inputCount > 1,
          fork: outputCount > 1,
          cycle: stage?.cycle || false,
        },
      };
    });
    const visible = new Set(steps.map((step) => step.id));
    const connections = ordered
      .filter((edge) => visible.has(edge.source) || visible.has(edge.target))
      .map((edge) => ({
        edge,
        source: edge.source,
        target: edge.target,
        sourceVisible: visible.has(edge.source),
        targetVisible: visible.has(edge.target),
        sourcePage: Math.floor(positions.get(edge.source) / pageSize),
        targetPage: Math.floor(positions.get(edge.target) / pageSize),
      }));
    const stageGroups = new Map();
    for (const step of steps) {
      if (!stageGroups.has(step.stage))
        stageGroups.set(step.stage, {
          index: step.stage,
          kind: step.kind,
          steps: [],
        });
      stageGroups.get(step.stage).steps.push(step);
    }
    return {
      chapterId,
      kind,
      label,
      total,
      page: currentPage,
      currentPage,
      pageSize,
      pageCount,
      previous: currentPage > 0 ? currentPage - 1 : null,
      next: currentPage + 1 < pageCount ? currentPage + 1 : null,
      entry,
      steps,
      stages: [...stageGroups.values()],
      connections,
    };
  }
  return { buildRoute };
});
