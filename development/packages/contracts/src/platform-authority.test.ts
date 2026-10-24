import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOT_ADMIN_UIDS,
  isPlatformRootAdminUid,
  platformRootAdminUids,
} from './platform-authority.js';

describe('configured platform root identities', () => {
  it('always retains the explicitly appointed root and extends it with server configuration', () => {
    expect(DEFAULT_ROOT_ADMIN_UIDS).toEqual(['u_48370eb1aba453c7']);
    expect(platformRootAdminUids(' another-root, another-root, ')).toEqual([
      'u_48370eb1aba453c7',
      'another-root',
    ]);
    expect(isPlatformRootAdminUid('u_48370eb1aba453c7', 'another-root')).toBe(true);
    expect(isPlatformRootAdminUid('ordinary-admin')).toBe(false);
  });
  it('rejects malformed configured UIDs', () => {
    expect(() => platformRootAdminUids('bad\u0001uid')).toThrow('invalid UID');
    expect(() => platformRootAdminUids('x'.repeat(129))).toThrow('invalid UID');
  });
});
