import { useMemo, useState, type FormEvent } from 'react';

import { DetailSection } from '../../components/DetailSection.js';
import type { LiaisonPost, LiaisonTeam } from './model.js';

export interface ProblemCommunityProps {
  posts: readonly LiaisonPost[];
  teams: readonly LiaisonTeam[];
  currentUid: string;
  canPost?: boolean;
  pending: boolean;
  onPost: (input: {
    teamId: string | null;
    kind: 'discussion' | 'progress';
    body: string;
  }) => Promise<boolean>;
  canEdit: (post: LiaisonPost) => boolean;
  canHide: (post: LiaisonPost) => boolean;
  onEdit: (postId: string, body: string) => Promise<boolean>;
  onHide: (postId: string) => Promise<void>;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function ProblemCommunity({
  posts,
  teams,
  currentUid,
  canPost = true,
  pending,
  onPost,
  canEdit,
  canHide,
  onEdit,
  onHide,
}: ProblemCommunityProps) {
  const [kind, setKind] = useState<'discussion' | 'progress'>('discussion');
  const [teamId, setTeamId] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const memberTeams = teams.filter((team) =>
    team.members.some((member) => member.memberUid === currentUid && member.status === 'active'),
  );
  const orderedPosts = useMemo(
    () =>
      [...posts].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
    [posts],
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) {
      setError('请填写讨论或进展内容');
      return;
    }
    if (kind === 'progress' && !teamId) {
      setError('发布进展前请选择所属团队');
      return;
    }
    setError(null);
    const saved = await onPost({
      teamId: kind === 'progress' ? teamId : null,
      kind,
      body: body.trim(),
    });
    if (saved) setBody('');
  }

  return (
    <DetailSection
      title="进度讨论"
      description="只围绕当前课题交流，按时间正序排列，最新内容显示在最后。"
    >
      {orderedPosts.length === 0 ? (
        <p>还没有讨论，欢迎提出第一个问题。</p>
      ) : (
        <ol className="liaison-community-list" aria-label="课题进度讨论">
          {orderedPosts.map((post) => (
            <li key={post.id}>
              <p>
                <strong>{post.kind === 'progress' ? '团队进展' : '讨论'}</strong> · {post.authorUid}
              </p>
              {editingPostId === post.id ? (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!editingBody.trim()) {
                      setError('动态内容不能为空');
                      return;
                    }
                    if (await onEdit(post.id, editingBody.trim())) setEditingPostId(null);
                  }}
                >
                  <label>
                    编辑动态内容
                    <textarea
                      value={editingBody}
                      maxLength={20000}
                      onChange={(event) => setEditingBody(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={pending}>
                    保存动态修改
                  </button>
                  <button type="button" disabled={pending} onClick={() => setEditingPostId(null)}>
                    取消
                  </button>
                </form>
              ) : (
                <p>{post.body}</p>
              )}
              <time dateTime={post.createdAt}>{formatDateTime(post.createdAt)}</time>
              {canEdit(post) && editingPostId !== post.id ? (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={pending}
                  aria-label={`编辑动态：${post.body}`}
                  onClick={() => {
                    setEditingPostId(post.id);
                    setEditingBody(post.body);
                  }}
                >
                  编辑
                </button>
              ) : null}
              {canHide(post) ? (
                <button
                  type="button"
                  className="secondary-action"
                  disabled={pending}
                  aria-label={`隐藏动态：${post.body}`}
                  onClick={() => void onHide(post.id)}
                >
                  隐藏违规内容
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canPost ? (
        <form onSubmit={submit} noValidate>
          <label>
            内容类型
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as 'discussion' | 'progress')}
            >
              <option value="discussion">公开讨论</option>
              {memberTeams.length > 0 ? <option value="progress">团队进展</option> : null}
            </select>
          </label>
          {kind === 'progress' ? (
            <label>
              所属团队
              <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                <option value="">选择团队</option>
                {memberTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            讨论内容
            <textarea
              value={body}
              maxLength={20000}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            {kind === 'progress' ? '发布进展' : '发布讨论'}
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      ) : null}
    </DetailSection>
  );
}
