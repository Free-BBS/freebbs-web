import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { UserContext } from '@freebbs-development/contracts';
import {
  ApiClient,
  ApiError,
  AUTH_TOKEN_STORAGE_KEY,
  createApiClient,
  isDemoUserId,
  type AuthMode,
  type DemoUserId,
} from '../api/client.js';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'denied' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: UserContext | null;
  error: Error | null;
  reload: () => Promise<void>;
  loginUrl: string;
  authMode: AuthMode;
  demoUser: DemoUserId | null;
  setDemoUser: (userId: string) => void;
  previewUser: string | null;
  setPreviewUser: (uid: string | null) => void;
  client: ApiClient;
}

export interface AuthProviderProps {
  children: ReactNode;
  client?: ApiClient;
}

export interface ReturnLocation {
  pathname: string;
  search: string;
  hash: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function mainSiteLoginHref(location?: ReturnLocation): string {
  const activeLocation = location ?? (typeof window === 'undefined' ? undefined : window.location);
  const pathname = activeLocation?.pathname ?? '/development/';
  const returnTo =
    pathname === '/development' || pathname.startsWith('/development/')
      ? `${pathname}${activeLocation?.search ?? ''}${activeLocation?.hash ?? ''}`
      : '/development/';

  return `/login?next=${encodeURIComponent(returnTo)}`;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Unable to load authentication state');
}

export function AuthProvider({ children, client }: AuthProviderProps) {
  const defaultClient = useMemo(createApiClient, []);
  const activeClient = client ?? defaultClient;
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserContext | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [demoUser, setDemoUserState] = useState<DemoUserId | null>(activeClient.demoUser);
  const requestGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setStatus('loading');
    setError(null);
    try {
      const loadedUser = await activeClient.request<UserContext>('/me');
      if (generation !== requestGeneration.current) return;
      setUser(loadedUser);
      setStatus('authenticated');
    } catch (caught) {
      if (generation !== requestGeneration.current) return;
      setUser(null);
      if (caught instanceof ApiError && caught.status === 401) {
        setStatus('unauthenticated');
        return;
      }
      if (
        caught instanceof ApiError &&
        caught.status === 403 &&
        caught.code === 'preview_identity_denied'
      ) {
        activeClient.setPreviewUser(null);
        globalThis.location?.reload();
        return;
      }
      if (
        caught instanceof ApiError &&
        caught.status === 403 &&
        caught.code === 'preview_access_denied'
      ) {
        setStatus('denied');
        return;
      }
      setError(asError(caught));
      setStatus('error');
    }
  }, [activeClient]);

  useEffect(() => {
    void reload();
    return () => {
      requestGeneration.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    if (activeClient.authMode !== 'main') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_TOKEN_STORAGE_KEY || event.key === null) void reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [activeClient.authMode, reload]);

  const setDemoUser = useCallback(
    (userId: string) => {
      if (activeClient.authMode !== 'demo' || !isDemoUserId(userId)) {
        throw new Error('Demo user must be selected from the exported allowlist');
      }
      activeClient.setDemoUser(userId);
      setDemoUserState(userId);
      void reload();
    },
    [activeClient, reload],
  );

  const setPreviewUser = useCallback(
    (uid: string | null) => {
      activeClient.setPreviewUser(uid);
      void reload();
    },
    [activeClient, reload],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      error,
      reload,
      loginUrl: mainSiteLoginHref(),
      authMode: activeClient.authMode,
      demoUser,
      setDemoUser,
      previewUser: activeClient.previewUser,
      setPreviewUser,
      client: activeClient,
    }),
    [activeClient, demoUser, error, reload, setDemoUser, setPreviewUser, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function useAuth(): AuthContextValue {
  const value = useOptionalAuth();
  if (value === null) throw new Error('useAuth must be used within an AuthProvider');
  return value;
}
