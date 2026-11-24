import { useCallback, useEffect, useRef, useState } from 'react';
import type { BannerReactions, UpdateBannerReactionsInput } from '@freebbs-development/contracts';
import { ApiError, type ApiClient } from '../core/api/client.js';
import { useOptionalAuth } from '../core/auth/AuthProvider.js';
import { BannerCelebration } from './BannerCelebration.js';

interface Props {
  bannerId: string;
  client?: ApiClient;
}

const clientVersions = new WeakMap<ApiClient, number>();
let nextClientVersion = 0;
function clientVersion(client?: ApiClient): number {
  if (!client) return 0;
  let version = clientVersions.get(client);
  if (version === undefined) {
    version = ++nextClientVersion;
    clientVersions.set(client, version);
  }
  return version;
}

function reactionError(error: unknown, saving: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录状态已失效，请刷新后重试';
    if (error.code === 'banner_interaction_forbidden') return '当前身份不能参与横幅互动';
    if (error.code === 'banner_identity_inactive') return '当前账号暂不能参与横幅互动';
    if (error.code === 'banner_not_published') return '这幅横幅已下线，请刷新页面';
    if (
      [
        'banner_storage_not_configured',
        'banner_storage_unavailable',
        'banner_storage_configuration_conflict',
        'feature_busy',
      ].includes(error.code)
    )
      return '互动服务暂时不可用，请稍后再试';
  }
  return saving ? '未能保存，请重试' : '互动暂时不可用';
}

function ReactionIcon({ kind }: { kind: 'heart' | 'fireworks' | 'gift' }) {
  return (
    <svg
      className="festival-reaction-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'heart' ? (
        <path d="M20.5 5.7a5 5 0 0 0-7.1 0L12 7.1l-1.4-1.4a5 5 0 0 0-7.1 7.1L12 21l8.5-8.2a5 5 0 0 0 0-7.1Z" />
      ) : kind === 'gift' ? (
        <>
          <path d="M4 11h16v10H4zM3 7h18v4H3zM12 7v14" />
          <path d="M12 7C6 7 5 5 6 3c2-2 5 0 6 4ZM12 7c6 0 7-2 6-4-2-2-5 0-6 4Z" />
        </>
      ) : (
        <>
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" />
          <path d="m12 8 1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2Z" />
        </>
      )}
    </svg>
  );
}

export function BannerInteractions({ bannerId, client }: Props) {
  const auth = useOptionalAuth();
  const activeClient = client ?? auth?.client;
  const identity = JSON.stringify([
    bannerId,
    clientVersion(activeClient),
    auth?.user?.uid,
    auth?.demoUser,
    activeClient?.demoUser,
    auth?.previewUser,
    auth?.user?.previewing,
  ]);
  return (
    <BannerInteractionControls
      key={identity}
      bannerId={bannerId}
      client={activeClient}
      readOnly={Boolean(auth?.previewUser || auth?.user?.previewing)}
    />
  );
}

function BannerInteractionControls({ bannerId, client, readOnly }: Props & { readOnly: boolean }) {
  const [snapshot, setSnapshot] = useState<{ client: ApiClient; data: BannerReactions } | null>(
    null,
  );
  const data = snapshot?.client === client ? snapshot?.data : null;
  const [loading, setLoading] = useState(Boolean(client));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [burst, setBurst] = useState({ id: 0, kind: 'fireworks' as 'fireworks' | 'blessing' });
  const [cooling, setCooling] = useState(false);
  const cooldown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireworksLocked = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const path = `/community/banner-reactions/${encodeURIComponent(bannerId)}`;

  const load = useCallback(async () => {
    const request = ++generation.current;
    setError('');
    if (!client) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await client.request<BannerReactions>(path);
      if (!next || next.bannerId !== bannerId) throw new Error('Invalid banner response');
      if (request === generation.current) setSnapshot({ client, data: next });
    } catch (error) {
      if (request === generation.current) setError(reactionError(error, false));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [client, path, bannerId]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  useEffect(
    () => () => {
      if (cooldown.current) clearTimeout(cooldown.current);
    },
    [],
  );

  async function react(input: UpdateBannerReactionsInput) {
    if (!client || !data || pending || readOnly || inFlight.current) return;
    inFlight.current = true;
    const request = generation.current;
    setPending(true);
    setError('');
    setFeedback('');
    try {
      const next = await client.request<BannerReactions>(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!next || next.bannerId !== bannerId) throw new Error('Invalid banner response');
      if (request !== generation.current) return;
      setSnapshot({ client, data: next });
      if (input.blessed) {
        setFeedback('祝福已送达！');
        setBurst((current) => ({ id: current.id + 1, kind: 'blessing' }));
      } else setFeedback(next.liked ? '谢谢你的喜欢！' : '已取消点赞');
    } catch (error) {
      if (request === generation.current) setError(reactionError(error, true));
    } finally {
      inFlight.current = false;
      if (request === generation.current) setPending(false);
    }
  }

  function celebrate() {
    if (fireworksLocked.current) return;
    fireworksLocked.current = true;
    setCooling(true);
    setBurst((current) => ({ id: current.id + 1, kind: 'fireworks' }));
    setFeedback('烟花已绽放，快乐加一！');
    cooldown.current = setTimeout(() => {
      fireworksLocked.current = false;
      setCooling(false);
    }, 900);
  }

  const disabled = !data || loading || pending || readOnly;
  return (
    <>
      <BannerCelebration burstId={burst.id} kind={burst.kind} />
      <div className="festival-banner-reactions" role="group" aria-label="横幅互动">
        <button
          type="button"
          className={data?.liked ? 'is-active' : ''}
          aria-pressed={Boolean(data?.liked)}
          disabled={disabled}
          onClick={() => void react({ liked: !data?.liked })}
        >
          <ReactionIcon kind="heart" />
          <span>{data?.liked ? '已点赞' : '点赞'}</span>
          <span className="festival-reaction-count">{data?.likeCount ?? '—'}</span>
        </button>
        <button type="button" disabled={cooling} onClick={celebrate}>
          <ReactionIcon kind="fireworks" />
          <span>放烟花</span>
        </button>
        <button
          type="button"
          className={data?.blessed ? 'is-active' : ''}
          disabled={disabled || data?.blessed}
          onClick={() => void react({ blessed: true })}
        >
          <ReactionIcon kind="gift" />
          <span>{data?.blessed ? '已送达' : '送祝福'}</span>
          <span className="festival-reaction-count">{data?.blessingCount ?? '—'}</span>
        </button>
      </div>
      <p className="festival-banner-feedback" aria-live="polite">
        {error || feedback}
        {error ? (
          <button type="button" disabled={loading || pending} onClick={() => void load()}>
            重新同步
          </button>
        ) : null}
      </p>
    </>
  );
}
