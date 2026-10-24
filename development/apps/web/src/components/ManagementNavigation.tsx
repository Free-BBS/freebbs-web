import { NavLink } from 'react-router-dom';
import {
  canViewSystemSettings,
  isSuperAdmin,
  type PresentationUser,
} from '../core/permissions/Can.js';
import './management-navigation.css';

export function ManagementNavigation({ user }: { user: PresentationUser | null | undefined }) {
  if (!user || !Array.isArray(user.roles)) return null;
  const organizationSettings = canViewSystemSettings(user);
  const appointments = isSuperAdmin(user);
  if (!organizationSettings && !appointments) return null;
  return (
    <nav className="management-navigation" aria-label="管理员端导航">
      {organizationSettings ? <NavLink to="/system-settings">人员与组织</NavLink> : null}
      {appointments ? <NavLink to="/admin">负责人任命</NavLink> : null}
    </nav>
  );
}
