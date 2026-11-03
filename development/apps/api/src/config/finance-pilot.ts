/** Missing configuration preserves shared financial permissions; an empty list never opens access. */
export function normalizeFinancePilotUids(
  value: readonly string[] | undefined,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000)
    throw new Error('FINANCE_PILOT_UIDS must contain 1–1000 valid UIDs when configured');
  const uids = value.map((uid) => (typeof uid === 'string' ? uid.trim() : ''));
  if (
    uids.some(
      (uid) =>
        !uid ||
        uid.length > 128 ||
        /\s/u.test(uid) ||
        [...uid].some((character) => {
          const code = character.codePointAt(0)!;
          return code < 32 || code === 127;
        }),
    )
  )
    throw new Error('FINANCE_PILOT_UIDS contains an empty or invalid UID');
  return [...new Set(uids)];
}
