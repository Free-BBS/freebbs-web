import type { UserContext } from './auth.js';
import { isDevelopmentBusinessAdmin } from './system-settings.js';

/** Organization business supervision does not grant platform settings or admission access. */
export function isGlobalOrganizationBusinessSupervisor(
  user: Pick<UserContext, 'roles' | 'businessAdmin'> | null | undefined,
): boolean {
  return (
    isDevelopmentBusinessAdmin(user) ||
    user?.roles.some(
      (role) => role === 'counselor.youth_league_secretary' || role === 'counselor.youth_league',
    ) === true
  );
}
