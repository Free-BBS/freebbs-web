import type { InformationFeedItem } from '@freebbs-development/contracts';

const statusLabels = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
  open: '待回应',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
} as const;

export interface InformationFeedCardProps {
  item: InformationFeedItem;
  onOpen(item: InformationFeedItem): void;
  onToggleLike(item: InformationFeedItem): void;
}

export function InformationFeedCard({ item, onOpen, onToggleLike }: InformationFeedCardProps) {
  const isPrivate = item.kind === 'consultation' && item.visibility === 'private';
  const label = item.kind === 'announcement' ? '官方发布' : isPrivate ? '私密咨询' : '公开反馈';
  return (
    <article
      className={`information-card information-card--${item.kind === 'announcement' ? 'official' : isPrivate ? 'private' : 'feedback'}`}
    >
      <button className="information-card__body" type="button" onClick={() => onOpen(item)}>
        <div className="information-card__meta">
          <span className="information-kind">
            {isPrivate ? '▣ ' : ''}
            {label}
          </span>
          {item.kind === 'announcement' && item.pinned ? <span>置顶</span> : null}
          <span className="information-status" data-status={item.status}>
            {statusLabels[item.status]}
          </span>
          <time dateTime={item.updatedAt}>
            {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
          </time>
        </div>
        <h3>{item.title}</h3>
        <p>{item.body}</p>
        {isPrivate ? <span className="information-private-note">🔒 仅你与负责人可见</span> : null}
      </button>
      {!isPrivate ? (
        <footer className="information-card__actions">
          <button
            type="button"
            className={item.likedByViewer ? 'is-active' : ''}
            aria-pressed={item.likedByViewer}
            onClick={() => onToggleLike(item)}
          >
            ♡ {item.likeCount} 人赞同
          </button>
          <button type="button" onClick={() => onOpen(item)}>
            💬 {item.replyCount} 条回复
          </button>
        </footer>
      ) : null}
    </article>
  );
}
