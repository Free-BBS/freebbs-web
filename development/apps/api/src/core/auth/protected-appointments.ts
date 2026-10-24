import {
  ROOT_MANAGED_ROLE_KEYS,
  isPlatformRootAdminUid,
  type RoleKey,
  type ScopeRef,
} from '@freebbs-development/contracts';
import { HttpError } from '../errors/http-error.js';

export function isRootManagedGlobalAppointment(roleKey: RoleKey, scope: ScopeRef): boolean {
  return (
    ROOT_MANAGED_ROLE_KEYS.some((key) => key === roleKey) &&
    scope.type === 'public' &&
    scope.id === '*'
  );
}

/** rootAdmin must come from trusted authentication, never request body or provider flags. */
export function canChangeRootManagedAppointments(actorUid: string, rootAdmin = false): boolean {
  return rootAdmin || isPlatformRootAdminUid(actorUid, process.env.PLATFORM_ROOT_ADMIN_UIDS);
}

export function requireRootAppointmentAuthority(actorUid: string, rootAdmin = false): void {
  if (!canChangeRootManagedAppointments(actorUid, rootAdmin))
    throw new HttpError(
      403,
      'root_appointment_required',
      '管理员及自动管理员身份须由最高管理员任命或撤销',
    );
}
