export type TransitionGraph<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(
  graph: TransitionGraph<S>,
  from: S,
  to: S,
): boolean {
  return graph[from].includes(to);
}
