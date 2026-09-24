import { describe, expect, it } from 'vitest';

import { canTransition } from './state-machine.js';

describe('canTransition', () => {
  const graph = {
    draft: ['published'],
    published: ['draft', 'archived'],
    archived: [],
  } as const;

  it('accepts an explicitly configured transition', () => {
    expect(canTransition(graph, 'draft', 'published')).toBe(true);
    expect(canTransition(graph, 'published', 'draft')).toBe(true);
  });

  it('rejects skipped, terminal, and same-state transitions', () => {
    expect(canTransition(graph, 'draft', 'archived')).toBe(false);
    expect(canTransition(graph, 'archived', 'draft')).toBe(false);
    expect(canTransition(graph, 'published', 'published')).toBe(false);
  });
});
