import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EditorDrawer } from '../../components/EditorDrawer.js';
import type { ApiClient } from '../../core/api/client.js';
import {
  buildCandidates,
  dailyDeck,
  matchedInterests,
  normalizePreferences,
  readPreferences,
  savePreferences,
  type Sources,
} from './model.js';
import { DISCOVERY_CONFIG, KIND_LABELS, type DiscoveryConfig } from './site-config.js';

interface Props {
  client: Pick<ApiClient, 'request'>;
  uid: string;
  config?: DiscoveryConfig;
  activities?: Sources['activities'] | null;
}

// Remount on account changes even when used outside the route-level auth boundary.
export function DailyDiscovery(props: Props) {
  return <DiscoveryCard key={props.uid} {...props} />;
}
function DiscoveryCard({ client, uid, config = DISCOVERY_CONFIG, activities }: Props) {
  const hasSharedActivities = activities !== undefined;
  const keywordHelpId = useId();
  const [preferences, setPreferences] = useState(() => readPreferences(uid));
  const [draft, setDraft] = useState(preferences);
  const [keywords, setKeywords] = useState(preferences.interests.join('，'));
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [sources, setSources] = useState<Sources>({ activities: [], knowledge: [] });
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [failed, setFailed] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!config.enabled) return;
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [config.enabled]);
  useEffect(() => {
    if (!config.enabled) return;
    let active = true;
    setState('loading');
    setFailed([]);
    setCursor(0);
    setSources({ activities: [], knowledge: [] });
    const requests = [
      { kind: 'activity', field: 'activities', path: '/events/activities' },
      { kind: 'knowledge', field: 'knowledge', path: '/knowledge/entries?audience=general' },
    ] as const;
    const selected = requests.filter(
      ({ kind }) =>
        config.allowedKinds.includes(kind) && !(kind === 'activity' && hasSharedActivities),
    );
    let pending = selected.length;
    if (pending === 0) setState('ready');
    const cleanups = selected.map(({ kind, field, path }) => {
      const controller = new AbortController();
      let timeout = 0;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          controller.abort();
          reject(new Error('Source timed out'));
        }, 8000);
      });
      void Promise.race([
        client.request<Sources['activities']>(path, { signal: controller.signal }),
        deadline,
      ])
        .then((result) => {
          if (!Array.isArray(result)) throw new Error('Invalid source');
          if (active) setSources((value) => ({ ...value, [field]: result }));
        })
        .catch(() => {
          if (active) setFailed((value) => [...value, KIND_LABELS[kind]]);
        })
        .finally(() => {
          window.clearTimeout(timeout);
          pending -= 1;
          if (active && pending === 0) setState('ready');
        });
      return () => {
        window.clearTimeout(timeout);
        controller.abort();
      };
    });
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [client, config, attempt, hasSharedActivities]);
  const candidates = useMemo(
    () =>
      buildCandidates(
        { ...sources, ...(hasSharedActivities ? { activities: activities ?? [] } : {}) },
        now,
        config,
      ),
    [sources, now, config, hasSharedActivities, activities],
  );
  const deck = useMemo(
    () => dailyDeck(candidates, preferences, uid, now),
    [candidates, preferences, uid, now],
  );
  const current = deck.length ? deck[cursor % deck.length] : undefined;
  const matches = current ? matchedInterests(current, preferences) : [];
  function edit() {
    setDraft(preferences);
    setKeywords(preferences.interests.join('，'));
    setFormError(null);
    setOpen(true);
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.kinds.some((kind) => config.allowedKinds.includes(kind))) {
      setFormError('请至少选择一种可推荐的内容。');
      return;
    }
    const interests = keywords
      .split(/[,，\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (interests.length > 8 || interests.some((value) => value.length > 24)) {
      setFormError('最多填写 8 个兴趣，每个不超过 24 个字符。');
      return;
    }
    const next = normalizePreferences({ ...draft, interests });
    setPreferences(next);
    setCursor(0);
    setOpen(false);
    setStorageNotice(
      savePreferences(uid, next)
        ? '偏好已保存到当前浏览器。'
        : '当前浏览器无法保存偏好，本次浏览仍会生效。',
    );
  }
  if (!config.enabled) return null;
  return (
    <section className="daily-discovery" aria-label="今日随机发现">
      <div className="discovery-heading">
        <div>
          <p className="discovery-eyebrow">给今天一点新鲜感</p>
          <h3>今日随机发现</h3>
        </div>
        <button className="discovery-settings" type="button" onClick={edit}>
          偏好设置
        </button>
      </div>
      <div className="discovery-content" aria-live="polite" aria-busy={state === 'loading'}>
        {state === 'loading' ? (
          <p role="status">正在寻找今天的新发现…</p>
        ) : current ? (
          <>
            <div className="discovery-copy">
              <span className="discovery-kind">{KIND_LABELS[current.kind]}</span>
              <h4>{current.title}</h4>
              {current.summary && <p className="discovery-summary">{current.summary}</p>}
              <p className="discovery-reason">
                {matches.length
                  ? `与你的兴趣「${matches.join('、')}」有关`
                  : preferences.interests.length
                    ? '偶尔尝试兴趣之外的新鲜事'
                    : '每日换个视角，发现校园新鲜事'}
              </p>
            </div>
            <div className="discovery-actions">
              <Link className="discovery-open" to={current.href}>
                去看看 <span aria-hidden="true">↗</span>
              </Link>
              <button
                type="button"
                onClick={() => setCursor((value) => value + 1)}
                disabled={deck.length < 2}
              >
                换一个
              </button>
            </div>
          </>
        ) : (
          <div className="discovery-empty">
            <p>暂时没有符合偏好的内容</p>
            <button type="button" onClick={edit}>
              调整偏好
            </button>
          </div>
        )}
      </div>
      {failed.length > 0 && (
        <p className="discovery-notice" role="status">
          {failed.join('、')}暂时无法加载。
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            重试加载
          </button>
        </p>
      )}
      {storageNotice && (
        <p className="discovery-notice" role="status">
          {storageNotice}
        </p>
      )}
      <EditorDrawer
        open={open}
        title="发现偏好"
        description="选择你感兴趣的内容，让今天的发现更合心意。"
        onClose={() => setOpen(false)}
      >
        <form className="discovery-preferences" onSubmit={save}>
          <fieldset>
            <legend>想发现什么</legend>
            <div className="discovery-options">
              {config.allowedKinds.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={draft.kinds.includes(kind)}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        kinds: event.target.checked
                          ? [...value.kinds, kind]
                          : value.kinds.filter((item) => item !== kind),
                      }))
                    }
                  />
                  {KIND_LABELS[kind]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="discovery-field">
            兴趣关键词
            <input
              aria-label="兴趣关键词"
              aria-describedby={keywordHelpId}
              value={keywords}
              maxLength={220}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="例如：跑步，摄影，科创"
            />
            <span id={keywordHelpId}>用逗号分隔，最多 8 个；留空则随心发现。</span>
          </label>
          <div className="discovery-suggestions" aria-label="兴趣建议">
            {config.suggestedInterests.map((interest) => (
              <button
                key={interest}
                type="button"
                onClick={() =>
                  setKeywords((value) =>
                    [
                      ...new Set([
                        ...value
                          .split(/[,，\n]/)
                          .map((item) => item.trim())
                          .filter(Boolean),
                        interest,
                      ]),
                    ].join('，'),
                  )
                }
              >
                + {interest}
              </button>
            ))}
          </div>
          <label className="discovery-field">
            活动时间范围
            <select
              value={draft.days}
              onChange={(event) =>
                setDraft((value) => ({ ...value, days: Number(event.target.value) as 7 | 30 | 90 }))
              }
            >
              <option value={7}>未来 7 天</option>
              <option value={30}>未来 30 天</option>
              <option value={90}>未来 90 天</option>
            </select>
          </label>
          <label className="discovery-explore">
            <input
              type="checkbox"
              checked={draft.explore}
              onChange={(event) =>
                setDraft((value) => ({ ...value, explore: event.target.checked }))
              }
            />
            也看看兴趣之外的内容
          </label>
          <p className="discovery-footnote">
            兴趣匹配会提高推荐机会。偏好仅保存在当前浏览器，按账号区分。
          </p>
          {formError && <p role="alert">{formError}</p>}
          <div className="discovery-form-actions">
            <button type="submit">保存偏好</button>
            <button
              type="button"
              onClick={() => {
                setDraft(normalizePreferences(null));
                setKeywords('');
                setFormError(null);
              }}
            >
              恢复默认
            </button>
          </div>
        </form>
      </EditorDrawer>
    </section>
  );
}
