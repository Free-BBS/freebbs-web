import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DEPARTMENT_DIRECTORY,
  departmentsForRoles,
  PUBLISHING_CATEGORIES,
  type PublishingContent,
  type PublishingCategory,
  type PublishingList,
} from '@freebbs-development/contracts';
import { useAuth } from '../../core/auth/AuthProvider.js';
import './publishing.css';
export const categoryLabels: Record<PublishingCategory, string> = {
  article: '活动文章',
  notices: '通知',
  schedules: '每周安排',
  public_info: '公开信息',
  guides: '操作指南',
  resources: '资源与系友',
  contacts: '部门通讯录',
  course_experience: '课程经验',
  work_experience: '工作经验',
  practice_channels: '实践渠道',
  book_share: '书籍分享',
};
const noticeCategories: PublishingCategory[] = ['notices', 'schedules', 'public_info'];
export function PublishingPage({ book }: { book?: 'notices' | 'experience' }) {
  const { client, user } = useAuth();
  const { contentId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [list, setList] = useState<PublishingList>();
  const [item, setItem] = useState<PublishingContent>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(search.get('category') ?? 'all');
  const searchText = search.toString();
  useEffect(() => {
    setCategory(search.get('category') ?? 'all');
    setEditing(false);
    setQuery('');
  }, [searchText, book, contentId, user?.uid]);
  useEffect(() => {
    let active = true;
    setError('');
    setItem(undefined);
    setList(undefined);
    client
      .request<PublishingList>('/publishing')
      .then((value) => {
        if (active) {
          setList(value);
          if (value.canCreate && search.get('create') === '1') setEditing(true);
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    if (contentId)
      client
        .request<PublishingContent>(`/publishing/${contentId}`)
        .then((value) => {
          if (active) setItem(value);
        })
        .catch((cause) => {
          if (active) setError(cause.message);
        });
    return () => {
      active = false;
    };
  }, [client, contentId, searchText, book, user?.uid]);
  async function mutate(path: string, value: unknown, method: 'POST' | 'PATCH' = 'POST') {
    setBusy(true);
    setError('');
    try {
      const result = await client.request<PublishingContent>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      setItem(result);
      setList((previous) =>
        previous
          ? {
              ...previous,
              items: [result, ...previous.items.filter((row) => row.id !== result.id)],
            }
          : previous,
      );
      setEditing(false);
      navigate(`/collections/publishing/${result.id}`);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const categories = PUBLISHING_CATEGORIES.filter(
    (key) =>
      (list?.availableCategories?.includes(key) ?? true) &&
      (!book ||
        (book === 'notices'
          ? noticeCategories.includes(key)
          : !noticeCategories.includes(key) && key !== 'article')),
  );
  const visible = list?.items.filter(
    (row) =>
      (!book || categories.includes(row.category)) &&
      (category === 'all' || row.category === category) &&
      (!search.get('department') || row.departmentId === search.get('department')) &&
      JSON.stringify([
        row.title,
        row.text,
        row.tags,
        row.course,
        row.year,
        row.author,
        row.recommendation,
        row.links,
        row.schedule,
      ])
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <main className="publishing-page">
      <header className="publishing-heading">
        <div>
          <Link to={book ? '/desk' : '/collections/showcase'}>
            ← {book ? '返回书桌' : '返回内容橱窗'}
          </Link>
          <p>THE CAMPUS LIBRARY</p>
          <h1>{book === 'notices' ? '通知册' : book === 'experience' ? '经验集' : '内容与资料'}</h1>
          <span>保存每一次分享，让经验和故事持续生长。</span>
        </div>
        {!contentId && list?.canCreate && categories.length > 0 && (
          <button type="button" onClick={() => setEditing(!editing)}>
            ＋ 创建内容
          </button>
        )}
        {item?.canManage && (
          <button type="button" onClick={() => setEditing(!editing)}>
            编辑内容
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="publishing-error">
          {error}{' '}
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </p>
      )}
      {editing && categories.length > 0 && (!contentId || item?.canManage) && (
        <PublishingEditor
          key={item?.id ?? `new:${book ?? ''}:${searchText}`}
          item={contentId ? item : undefined}
          categories={categories}
          departments={
            user?.roles.includes('platform.admin')
              ? [...DEPARTMENT_DIRECTORY]
              : departmentsForRoles(user?.roles ?? [])
          }
          departmentDefault={search.get('department') ?? ''}
          categoryDefault={
            categories.includes((search.get('category') ?? category) as PublishingCategory)
              ? ((search.get('category') ?? category) as PublishingCategory)
              : categories[0]
          }
          busy={busy}
          save={(value) =>
            mutate(
              item ? `/publishing/${item.id}` : '/publishing',
              { ...value, ...(item ? { revision: item.revision } : {}) },
              item ? 'PATCH' : 'POST',
            )
          }
        />
      )}
      {item ? (
        <article className="publishing-reader">
          <div className="publishing-meta">
            <span>{categoryLabels[item.category]}</span>
            <span>
              {item.status === 'draft' ? '草稿' : item.status === 'archived' ? '已归档' : '已发布'}
            </span>
            <span>{item.audience === 'department' ? '仅本部门' : '公开阅读'}</span>
          </div>
          <h2>{item.title}</h2>
          {item.author && <p>作者：{item.author}</p>}
          <div className="publishing-tags">
            {[item.course, item.year, ...item.tags].filter(Boolean).map((tag, index) => (
              <span key={index}>{tag}</span>
            ))}
          </div>
          <p className="publishing-text">{item.text}</p>
          {item.recommendation && (
            <p className="publishing-text">推荐理由：{item.recommendation}</p>
          )}
          {item.images.map((url) => (
            <img loading="lazy" referrerPolicy="no-referrer" key={url} src={url} alt={item.title} />
          ))}
          {item.schedule.map((row, index) => (
            <p key={index}>
              <time>{row.date}</time> ·{' '}
              {row.url ? (
                <a href={row.url} target="_blank" rel="noopener noreferrer">
                  {row.title} ↗
                </a>
              ) : (
                row.title
              )}
            </p>
          ))}
          <div className="publishing-links">
            {item.links.map((link, index) => (
              <a key={index} href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label || '打开资料'} ↗
              </a>
            ))}
          </div>
          {item.status === 'published' && (
            <footer className="publishing-actions">
              <button
                disabled={busy}
                type="button"
                onClick={() =>
                  void mutate(`/publishing/${item.id}/reaction`, {
                    revision: item.revision,
                    liked: !item.liked,
                  })
                }
              >
                {item.liked ? '♥ 已喜欢' : '♡ 喜欢'} {item.likeCount}
              </button>
              {item.category === 'book_share' && (
                <label>
                  我的评分
                  <select
                    disabled={busy}
                    value={item.myRating ?? 0}
                    onChange={(event) =>
                      void mutate(`/publishing/${item.id}/reaction`, {
                        revision: item.revision,
                        rating: Number(event.target.value),
                      })
                    }
                  >
                    <option value={0} disabled>
                      选择评分
                    </option>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <option key={score} value={score}>
                        {score} 星
                      </option>
                    ))}
                  </select>
                  <span>
                    {item.ratingAverage.toFixed(1)} / 5 · {item.ratingCount} 人评分
                  </span>
                </label>
              )}
            </footer>
          )}
          {item.canManage && (
            <div className="publishing-actions">
              {(['draft', 'published', 'archived'] as const)
                .filter((status) => status !== item.status)
                .map((status) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={status}
                    onClick={() =>
                      void mutate(
                        `/publishing/${item.id}`,
                        { revision: item.revision, status },
                        'PATCH',
                      )
                    }
                  >
                    {status === 'published' ? '发布' : status === 'draft' ? '转为草稿' : '归档'}
                  </button>
                ))}
            </div>
          )}
        </article>
      ) : !contentId ? (
        <>
          <div className="publishing-filters">
            <input
              aria-label="搜索内容"
              placeholder="搜索标题、课程、年份或标签"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="分类"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">全部分类</option>
              {categories.map((key) => (
                <option key={key} value={key}>
                  {categoryLabels[key]}
                </option>
              ))}
            </select>
            {book === 'experience' && <Link to="/organizations">组织结构与展厅 ↗</Link>}
            {book && (
              <Link
                to={book === 'notices' ? '/desk/information?filter=official' : '/desk/knowledge'}
              >
                {book === 'notices' ? '官方通知与历史消息 ↗' : '既有知识与经验 ↗'}
              </Link>
            )}
          </div>
          <div className="publishing-grid">
            {visible?.map((row) => (
              <Link
                className="publishing-card"
                key={row.id}
                to={`/collections/publishing/${row.id}`}
              >
                <span>
                  {categoryLabels[row.category]} ·{' '}
                  {row.status === 'published'
                    ? '已发布'
                    : row.status === 'draft'
                      ? '草稿'
                      : '已归档'}
                </span>
                <h2>{row.title}</h2>
                <p>{row.text.slice(0, 160) || row.recommendation || '打开阅读完整内容。'}</p>
                <footer>
                  {row.tags.join(' · ')} <span>♡ {row.likeCount}</span>
                </footer>
              </Link>
            ))}
          </div>
          {!list && !error && <p>正在整理资料…</p>}
          {visible?.length === 0 && <p className="publishing-empty">尚无符合条件的内容。</p>}
        </>
      ) : !error ? (
        <p>正在打开内容…</p>
      ) : null}
    </main>
  );
}
function PublishingEditor({
  item,
  categories,
  departments,
  departmentDefault,
  categoryDefault,
  busy,
  save,
}: {
  item?: PublishingContent;
  categories: readonly PublishingCategory[];
  departments: ReturnType<typeof departmentsForRoles>;
  departmentDefault: string;
  categoryDefault?: PublishingCategory;
  busy: boolean;
  save: (value: Record<string, unknown>) => Promise<boolean>;
}) {
  const [category, setCategory] = useState<PublishingCategory>(
    item?.category ?? categoryDefault ?? categories[0] ?? 'article',
  );
  const [title, setTitle] = useState(item?.title ?? '');
  const [text, setText] = useState(item?.text ?? '');
  const [department, setDepartment] = useState(item?.departmentId ?? departmentDefault);
  const [audience, setAudience] = useState(item?.audience ?? 'all');
  const [links, setLinks] = useState(
    item?.links.map((row) => `${row.label} | ${row.url}`).join('\n') ?? '',
  );
  const [images, setImages] = useState(item?.images.join('\n') ?? '');
  const [tags, setTags] = useState(item?.tags.join('，') ?? '');
  const [course, setCourse] = useState(item?.course ?? '');
  const [year, setYear] = useState(item?.year ?? '');
  const [author, setAuthor] = useState(item?.author ?? '');
  const [recommendation, setRecommendation] = useState(item?.recommendation ?? '');
  const [schedule, setSchedule] = useState(
    item?.schedule.map((row) => `${row.date} | ${row.title} | ${row.url}`).join('\n') ?? '',
  );
  return (
    <form
      className="publishing-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          category,
          title,
          text,
          departmentId: department || null,
          audience: category === 'contacts' ? 'department' : audience,
          status: item?.status ?? 'draft',
          links: links
            .split('\n')
            .filter((row) => row.trim())
            .map((row) => {
              const [label, ...url] = row.split('|');
              return { label: label?.trim() ?? '', url: url.join('|').trim() };
            }),
          images: images
            .split('\n')
            .map((row) => row.trim())
            .filter(Boolean),
          tags: tags
            .split(/[,，]/)
            .map((row) => row.trim())
            .filter(Boolean),
          course,
          year,
          author,
          recommendation,
          schedule: schedule
            .split('\n')
            .filter((row) => row.trim())
            .map((row) => {
              const [date, title, ...url] = row.split('|');
              return {
                date: date?.trim() ?? '',
                title: title?.trim() ?? '',
                url: url.join('|').trim(),
              };
            }),
        });
      }}
    >
      <h2>{item ? '编辑资料' : '创建草稿'}</h2>
      <div className="publishing-form-grid">
        <label>
          标题
          <input
            required
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          分类
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as PublishingCategory)}
          >
            {categories.map((key) => (
              <option key={key} value={key}>
                {categoryLabels[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          所属部门
          <select
            disabled={Boolean(item)}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">个人发布</option>
            {departments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.organizationName} · {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          阅读范围
          <select
            disabled={category === 'contacts'}
            value={category === 'contacts' ? 'department' : audience}
            onChange={(event) => setAudience(event.target.value as 'all' | 'department')}
          >
            <option value="all">公开阅读</option>
            <option value="department">仅本部门</option>
          </select>
        </label>
        <label className="wide">
          正文
          <textarea
            rows={8}
            maxLength={30000}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              category === 'contacts'
                ? '手动填写经同意分享的联系方式，不导入学生目录。'
                : '直接输入文字，内容按纯文本展示。'
            }
          />
        </label>
        <label>
          课程 / 项目
          <input
            maxLength={120}
            value={course}
            onChange={(event) => setCourse(event.target.value)}
          />
        </label>
        <label>
          年份
          <input maxLength={20} value={year} onChange={(event) => setYear(event.target.value)} />
        </label>
        <label className="wide">
          标签（逗号分隔）
          <input value={tags} onChange={(event) => setTags(event.target.value)} />
        </label>
        {category === 'book_share' && (
          <>
            <label>
              书籍作者
              <input
                maxLength={100}
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
              />
            </label>
            <label className="wide">
              推荐理由
              <textarea
                maxLength={4000}
                value={recommendation}
                onChange={(event) => setRecommendation(event.target.value)}
              />
            </label>
          </>
        )}
        <label className="wide">
          资料、微信或 Bilibili 链接（每行：名称 | HTTPS 地址）
          <textarea rows={3} value={links} onChange={(event) => setLinks(event.target.value)} />
        </label>
        <label className="wide">
          图片 HTTPS 地址（每行一个）
          <textarea rows={2} value={images} onChange={(event) => setImages(event.target.value)} />
        </label>
        {category === 'schedules' && (
          <label className="wide">
            每周安排（每行：YYYY-MM-DD | 安排名称 | 可选 HTTPS 链接）
            <textarea
              rows={5}
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
            />
          </label>
        )}
      </div>
      <button disabled={busy} type="submit">
        {busy ? '保存中…' : '保存内容'}
      </button>
      <small>首次保存为草稿；检查后可在阅读页发布。</small>
    </form>
  );
}
export function PublishingShelf() {
  return (
    <section className="publishing-shelf">
      <div>
        <p>持续更新的校园故事</p>
        <h2>文章与部门资料</h2>
        <span>浏览新发布的文章，或进入自己的部门继续创作。</span>
      </div>
      <Link to="/collections/publishing?category=article">打开内容与资料 ↗</Link>
    </section>
  );
}
