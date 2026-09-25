import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { API_BASE_PATH, ApiClient, ApiError, DEMO_USER_IDS } from '../api/client';
import { Can } from '../permissions/Can';
import { AuthProvider, mainSiteLoginHref, useAuth } from './AuthProvider';
import { DemoUserSwitcher } from './DemoUserSwitcher';

const STUDENT: UserContext = {
  uid: 'student-1',
  displayName: 'Lin Student',
  avatarUrl: '/avatars/student-1.png',
  baseRole: 'student',
  roles: [],
  tags: [],
};

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify({ data, requestId: 'request-test-1' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headersFromRequest(fetchMock: ReturnType<typeof vi.fn>, index = 0): Headers {
  const [input, init] = fetchMock.mock.calls[index] as [RequestInfo | URL, RequestInit?];
  return input instanceof Request ? input.headers : new Headers(init?.headers);
}

function RaceConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="race-user">{auth.user?.displayName ?? 'No user'}</span>
      <DemoUserSwitcher />
    </div>
  );
}

function AuthConsumer() {
  const auth = useAuth();
  if (auth.status === 'loading') return <p>Loading</p>;
  if (auth.status === 'denied') return <p>Preview denied</p>;
  if (auth.status === 'unauthenticated') return <a href={auth.loginUrl}>Main site login</a>;
  if (auth.status === 'error') return <p role="alert">{auth.error?.message}</p>;
  if (auth.user === null) return null;
  return (
    <div>
      <span>{auth.user.displayName}</span>
      {auth.user.avatarUrl === null ? null : (
        <img src={auth.user.avatarUrl} alt={`${auth.user.displayName} avatar`} />
      )}
      <DemoUserSwitcher />
    </div>
  );
}

describe('ApiClient authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses the fixed API base and sends the production token as Bearer authentication', async () => {
    window.localStorage.setItem('free_bbs_auth_token', 'opaque-main-site-token');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, STUDENT));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ApiClient({ authMode: 'main' }).request<UserContext>('/me')).resolves.toEqual(
      STUDENT,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_PATH}/me`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(headersFromRequest(fetchMock).get('Authorization')).toBe(
      'Bearer opaque-main-site-token',
    );
  });

  it('uses only an allowlisted demo identity and never leaks a Bearer token', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'demo');
    window.localStorage.setItem('free_bbs_auth_token', 'must-not-leak-to-demo');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, STUDENT));
    vi.stubGlobal('fetch', fetchMock);
    const client = new ApiClient({ authMode: 'demo', selectedDemoUserId: 'demo-student' });
    await client.request('/me');
    expect(headersFromRequest(fetchMock).get('X-Demo-User')).toBe('demo-student');
    expect(headersFromRequest(fetchMock).has('Authorization')).toBe(false);
    expect(() => client.setDemoUser('not-allowlisted')).toThrow(/allowlist/i);
  });

  it('accepts a successful 204 response without trying to parse JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(
      new ApiClient({ authMode: 'main' }).request<void>('/clubs/example/memberships', {
        method: 'DELETE',
      }),
    ).resolves.toBeUndefined();
  });

  it('unwraps the API error envelope with status, code, message and request ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          error: { code: 'identity_unavailable', message: 'Try later' },
        }),
      ),
    );
    await expect(new ApiClient({ authMode: 'main' }).request('/me')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'identity_unavailable',
      message: 'Try later',
      requestId: 'request-test-1',
    } satisfies Partial<ApiError>);
  });
});

describe('AuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('loads /me and exposes the display name and avatar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, STUDENT)));
    render(
      <AuthProvider client={new ApiClient({ authMode: 'main' })}>
        <AuthConsumer />
      </AuthProvider>,
    );
    expect(await screen.findByText('Lin Student')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Lin Student avatar' })).toHaveAttribute(
      'src',
      '/avatars/student-1.png',
    );
  });

  it('maps a 401 response to unauthenticated and exposes a fixed same-origin login path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { code: 'missing_identity', message: 'Login required' },
        }),
      ),
    );
    render(
      <AuthProvider client={new ApiClient({ authMode: 'main' })}>
        <AuthConsumer />
      </AuthProvider>,
    );
    expect(mainSiteLoginHref()).toBe('/login?next=%2Fdevelopment%2F');
    expect(await screen.findByRole('link', { name: 'Main site login' })).toHaveAttribute(
      'href',
      '/login?next=%2Fdevelopment%2F',
    );
  });

  it('maps a denied preview identity to a distinct state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(403, { error: { code: 'preview_access_denied', message: 'Not on list' } }),
        ),
    );
    render(
      <AuthProvider client={new ApiClient({ authMode: 'main' })}>
        <AuthConsumer />
      </AuthProvider>,
    );
    expect(await screen.findByText('Preview denied')).toBeInTheDocument();
  });

  it('drops the development identity when another tab signs out of the main site', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, STUDENT))
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'missing_identity', message: 'Login required' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider client={new ApiClient({ authMode: 'main' })}>
        <AuthConsumer />
      </AuthProvider>,
    );
    expect(await screen.findByText('Lin Student')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'free_bbs_auth_token' }));
    });

    expect(await screen.findByRole('link', { name: 'Main site login' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves an encoded development return location and fails closed for an external path', () => {
    expect(
      mainSiteLoginHref({
        pathname: '/development/events',
        search: '?filter=pending',
        hash: '#record-x',
      }),
    ).toBe('/login?next=%2Fdevelopment%2Fevents%3Ffilter%3Dpending%23record-x');
    expect(mainSiteLoginHref({ pathname: '//evil.example', search: '', hash: '' })).toBe(
      '/login?next=%2Fdevelopment%2F',
    );
  });
  it('renders the complete demo allowlist only in demo mode and reloads after switching', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'demo');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ...STUDENT, uid: 'demo-student' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { ...STUDENT, uid: 'demo-admin', displayName: 'Demo admin' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider
        client={new ApiClient({ authMode: 'demo', selectedDemoUserId: 'demo-student' })}
      >
        <AuthConsumer />
      </AuthProvider>,
    );
    const switcher = await screen.findByRole('combobox', { name: '预览身份 / Demo user' });
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(
      DEMO_USER_IDS,
    );
    await userEvent.selectOptions(switcher, 'demo-admin');
    expect(await screen.findByText('Demo admin')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(headersFromRequest(fetchMock, 1).get('X-Demo-User')).toBe('demo-admin');
  });

  it('ignores a stale identity response after switching demo users', async () => {
    vi.stubEnv('VITE_AUTH_MODE', 'demo');
    let resolveStudent!: (value: Response) => void;
    let resolveAdmin!: (value: Response) => void;
    const studentResponse = new Promise<Response>((resolve) => {
      resolveStudent = resolve;
    });
    const adminResponse = new Promise<Response>((resolve) => {
      resolveAdmin = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(studentResponse).mockReturnValueOnce(adminResponse),
    );

    render(
      <AuthProvider
        client={new ApiClient({ authMode: 'demo', selectedDemoUserId: 'demo-student' })}
      >
        <RaceConsumer />
      </AuthProvider>,
    );

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '预览身份 / Demo user' }),
      'demo-admin',
    );
    resolveAdmin(jsonResponse(200, { ...STUDENT, uid: 'demo-admin', displayName: 'Demo admin' }));
    await waitFor(() => expect(screen.getByTestId('race-user')).toHaveTextContent('Demo admin'));
    await act(async () => {
      resolveStudent(
        jsonResponse(200, { ...STUDENT, uid: 'demo-student', displayName: 'Demo student' }),
      );
      await studentResponse;
    });
    expect(screen.getByTestId('race-user')).toHaveTextContent('Demo admin');
  });

  it('does not render the demo switcher in main mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, STUDENT)));
    render(
      <AuthProvider client={new ApiClient({ authMode: 'main' })}>
        <AuthConsumer />
      </AuthProvider>,
    );
    expect(await screen.findByText('Lin Student')).toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: '预览身份 / Demo user' }),
    ).not.toBeInTheDocument();
  });
});

describe('Can', () => {
  it('uses presentation-only tag, policy and predicate checks with super-admin override', () => {
    const captain = { ...STUDENT, tags: [{ key: 'sports.team_captain' }] };
    const policyUser = {
      ...STUDENT,
      policies: [{ action: 'clubs.update', effect: 'allow' as const }],
    };
    const superAdmin = { ...STUDENT, roles: ['platform.super_admin' as const] };
    const { rerender } = render(
      <Can user={captain} tag="sports.team_captain" fallback="Denied">
        Captain tools
      </Can>,
    );
    expect(screen.getByText('Captain tools')).toBeInTheDocument();
    rerender(
      <Can user={policyUser} permission="clubs.update" fallback="Denied">
        Club tools
      </Can>,
    );
    expect(screen.getByText('Club tools')).toBeInTheDocument();
    rerender(
      <Can user={STUDENT} predicate={(user) => user.uid === 'someone-else'} fallback="Denied">
        Hidden
      </Can>,
    );
    expect(screen.getByText('Denied')).toBeInTheDocument();
    rerender(
      <Can user={superAdmin} permission="anything.at-all" fallback="Denied">
        Admin tools
      </Can>,
    );
    expect(screen.getByText('Admin tools')).toBeInTheDocument();
    rerender(
      <Can user={superAdmin} predicate={() => false} fallback="Denied by resource scope">
        Resource-scoped admin tools
      </Can>,
    );
    expect(screen.getByText('Denied by resource scope')).toBeInTheDocument();
  });
});
