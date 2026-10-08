import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  MODULE_MANIFESTS,
  resolveModuleStatus,
  type ModuleStateOverrides,
} from '../../app/module-manifests.js';

const books = [
  {
    id: 'notices',
    title: '通知册',
    subtitle: '校园消息 · 正式发布',
    note: '值得留意的每一件事',
    route: '/desk/information?filter=official',
    module: 'information',
    number: '01',
  },
  {
    id: 'consultations',
    title: '咨询手记',
    subtitle: '提问 · 反馈 · 回应',
    note: '把疑问放在这里',
    route: '/desk/information?filter=mine',
    module: 'information',
    number: '02',
  },
  {
    id: 'experience',
    title: '经验集',
    subtitle: '流程 · 方法 · 过来人的经验',
    note: '让下一次开始更从容',
    route: '/desk/knowledge',
    module: 'knowledge',
    number: '03',
  },
] as const;

function BookMark({ variant }: { variant: string }) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" focusable="false">
      {variant === 'notices' ? (
        <>
          <path d="M24 16h32v48H24zM31 28h18M31 37h18M31 46h11" />
          <path d="M20 24h4M20 33h4M20 42h4M20 51h4" />
        </>
      ) : variant === 'consultations' ? (
        <>
          <path d="M18 23h44v31H36L24 63v-9h-6z" />
          <path d="M29 34h23M29 43h15" />
        </>
      ) : (
        <>
          <path d="M40 25c-8-6-17-7-27-4v37c10-3 19-2 27 4 8-6 17-7 27-4V21c-10-3-19-2-27 4Z" />
          <path d="M40 25v37M21 31c5-1 9 0 13 2M21 40c5-1 9 0 13 2M47 33c4-2 8-3 13-2M47 42c4-2 8-3 13-2" />
        </>
      )}
    </svg>
  );
}

export function DeskPage({
  children,
  moduleStates,
}: {
  children?: ReactNode;
  moduleStates?: ModuleStateOverrides;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const reading = Boolean(children);
  const knowledge = /^(?:\/desk)?\/knowledge(?:\/|$)/.test(location.pathname);
  const selected = reading
    ? knowledge
      ? 'experience'
      : search.get('filter') === 'official'
        ? 'notices'
        : 'consultations'
    : null;
  const isEnabled = (id: 'information' | 'knowledge') => {
    const manifest = MODULE_MANIFESTS.find((module) => module.id === id)!;
    return resolveModuleStatus(manifest, moduleStates) === 'enabled';
  };
  const selectedBook = books.find((book) => book.id === selected);

  return (
    <section
      className={`desk-page${reading ? ' desk-page--reading' : ''}`}
      aria-labelledby="desk-title"
    >
      <header className="desk-header">
        <div>
          <p className="desk-eyebrow">THE CAMPUS STUDY · 校园的一张书桌</p>
          <h2 id="desk-title">
            無尽书桌<span aria-hidden="true">.</span>
          </h2>
          <p className="desk-introduction">消息、疑问与经验，都有一处可以安放。</p>
        </div>
        {reading ? (
          <Link className="desk-return" to="/desk">
            ← 合上书，回到书桌
          </Link>
        ) : (
          <span className="desk-header-note">留一盏灯，翻开新的一页。</span>
        )}
      </header>

      <div className="desk-scene">
        <div className="desk-scene-top" aria-hidden="true">
          <span className="desk-paper-note">
            慢慢读，也慢慢积累。<i>FREE / BBS</i>
          </span>
          <span className="desk-lamp">
            <i />
            <b />
          </span>
          <span className="desk-pencil" />
        </div>
        <div className="desk-books" role="group" aria-label="选择一本书">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              className={`desk-book desk-book--${book.id}`}
              aria-label={`打开${book.title}`}
              aria-pressed={selected === book.id}
              disabled={!isEnabled(book.module)}
              onClick={() => navigate(book.route)}
            >
              <span className="desk-book-cover">
                <span className="desk-book-edition">
                  FREE BBS <span>{book.number}</span>
                </span>
                <span className="desk-book-symbol">
                  <BookMark variant={book.id} />
                </span>
                <span className="desk-book-title">{book.title}</span>
                <span className="desk-book-subtitle">{book.subtitle}</span>
                <span className="desk-book-rule" />
                <span className="desk-book-note">{book.note}</span>
              </span>
              <span className="desk-book-open">
                {!isEnabled(book.module)
                  ? '暂未开放'
                  : selected === book.id
                    ? '正在阅读'
                    : '点击翻开'}{' '}
                <span aria-hidden="true">↗</span>
              </span>
            </button>
          ))}
        </div>
        {!reading ? (
          <footer className="desk-scene-footer">
            <span>三本书，一段校园生活。</span>
            <span>
              选择一本，开始阅读 <span aria-hidden="true">↑</span>
            </span>
          </footer>
        ) : null}
      </div>

      {reading ? (
        <div className="desk-reading-area">
          <div className="desk-reading-marker" aria-hidden="true">
            <span>{selectedBook?.number}</span> / {selectedBook?.title}
            <i />
          </div>
          {selectedBook && !isEnabled(selectedBook.module) ? (
            <p className="desk-unavailable" role="status">
              {selectedBook.title}暂未开放，请稍后再来。
            </p>
          ) : (
            children
          )}
        </div>
      ) : (
        <p className="desk-privacy-note">
          咨询默认私密，仅你与负责处理的同学可见。经验资料按你的访问权限开放。
        </p>
      )}
    </section>
  );
}
