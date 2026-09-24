import { DEMO_USERS } from '@freebbs-development/contracts';
import { useAuth } from './AuthProvider.js';

export function DemoUserSwitcher() {
  const { authMode, demoUser, setDemoUser } = useAuth();
  if (authMode !== 'demo' || demoUser === null) return null;

  return (
    <label className="demo-switcher">
      <span>预览身份</span>
      <select
        aria-label="预览身份 / Demo user"
        value={demoUser}
        onChange={(event) => setDemoUser(event.currentTarget.value)}
      >
        {DEMO_USERS.map(({ uid, displayName }) => (
          <option key={uid} value={uid}>
            {displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
