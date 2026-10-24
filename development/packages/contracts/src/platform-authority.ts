import defaults from './platform-authority.json' with { type: 'json' };

export const DEFAULT_ROOT_ADMIN_UIDS: readonly string[] = Object.freeze([
  ...defaults.rootAdminUids,
]);

/** Server configuration may add roots; it never removes the explicitly appointed default root. */
export function platformRootAdminUids(additionalUids?: string): readonly string[] {
  const additional = (additionalUids ?? '')
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean);
  if (
    additional.some(
      (uid) =>
        uid.length > 128 ||
        [...uid].some((character) => {
          const code = character.codePointAt(0)!;
          return code < 32 || code === 127;
        }),
    )
  )
    throw new Error('PLATFORM_ROOT_ADMIN_UIDS contains an invalid UID');
  return [...new Set([...DEFAULT_ROOT_ADMIN_UIDS, ...additional])];
}

export function isPlatformRootAdminUid(uid: string, additionalUids?: string): boolean {
  return platformRootAdminUids(additionalUids).includes(uid);
}
