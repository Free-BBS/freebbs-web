import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { OrganizationMark } from '../OrganizationMark.js';
import type { ShowcaseContent, ShowcaseImage, ShowcaseSection } from './types.js';
import imageDimensions from './image-dimensions.json';

function photoShape(image: ShowcaseImage) {
  const size = (imageDimensions as Record<string, { width: number; height: number }>)[image.src];
  const ratio = size ? size.width / size.height : 1.5;
  return ratio < 0.9 ? 'portrait' : ratio > 2.15 ? 'panorama' : 'landscape';
}

function contentStyle(content: ShowcaseContent): CSSProperties {
  return {
    '--sc-accent-light': content.accent,
    '--sc-accent-dark': content.darkAccent,
  } as CSSProperties;
}

function Photo({
  image,
  onOpen,
  href,
  linkLabel,
  hero = false,
}: {
  image: ShowcaseImage;
  onOpen: (image: ShowcaseImage) => void;
  href?: string;
  linkLabel?: string;
  hero?: boolean;
}) {
  const size = (imageDimensions as Record<string, { width: number; height: number }>)[image.src];
  const naturalRatio = size ? size.width / size.height : 1.5;
  const ratio =
    image.aspectRatio ??
    (hero ? 2.8 : image.fit === 'contain' || photoShape(image) === 'portrait' ? naturalRatio : 1.5);
  const photoStyle = {
    '--sc-photo-ratio': ratio,
    '--sc-photo-ratio-mobile': image.mobileAspectRatio ?? (hero ? Math.min(ratio, 1.9) : ratio),
  } as CSSProperties;
  const picture = (
    <>
      <img
        src={image.src}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        style={{
          objectFit: hero ? 'cover' : (image.fit ?? 'cover'),
          objectPosition: image.position,
        }}
      />
      <span className="sc-photo-zoom" aria-hidden="true">
        ↗
      </span>
    </>
  );
  return (
    <figure
      className={`sc-photo sc-photo--${photoShape(image)}${hero ? ' sc-photo--hero' : ''}`}
      style={photoStyle}
    >
      {href ? (
        href.startsWith('/') && !href.startsWith('//') ? (
          <Link to={href} aria-label={linkLabel}>
            {picture}
          </Link>
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={linkLabel}>
            {picture}
          </a>
        )
      ) : (
        <button
          type="button"
          onClick={() => onOpen(image)}
          aria-label={`查看大图：${image.caption ?? image.alt}`}
        >
          {picture}
        </button>
      )}
      {image.caption ? <figcaption>{image.caption}</figcaption> : null}
    </figure>
  );
}

function PhotoGallery({
  images,
  title,
  onOpen,
}: {
  images: ShowcaseImage[];
  title: string;
  onOpen: (image: ShowcaseImage) => void;
}) {
  const triptych =
    [3, 6].includes(images.length) && images.every((image) => photoShape(image) !== 'portrait');
  return (
    <div className="sc-album" role="group" aria-label={`${title}照片相册`}>
      <div
        className={`sc-photo-grid sc-photo-grid--composed${images.length === 1 ? ' sc-photo-grid--single' : ''}${triptych ? ' sc-photo-grid--triptych' : ''}`}
      >
        {images.map((image) => (
          <Photo key={image.src} image={image} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function SectionContent({
  section,
  onOpen,
}: {
  section: ShowcaseSection;
  onOpen: (image: ShowcaseImage) => void;
}) {
  const textTimeline =
    section.layout === 'timeline' &&
    Boolean(section.items?.length) &&
    (section.items ?? []).every((item) => !item.image && !item.images?.length);
  const body = (
    <>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {section.images?.length ? (
        <PhotoGallery images={section.images} title={section.title} onOpen={onOpen} />
      ) : null}
      {section.items?.length ? (
        <div
          className={`sc-items sc-items--${section.layout} sc-items--count-${section.items.length}${textTimeline ? ' sc-items--text-timeline' : ''}`}
        >
          {section.items.map((item, index) => (
            <article
              className={`sc-item${item.image ? ' sc-item--with-photo' : ''}${item.image && photoShape(item.image) === 'portrait' ? ' sc-item--portrait' : ''}${item.images?.length ? ' sc-item--with-album' : ''}`}
              key={`${item.title}:${index}`}
            >
              {item.image ? (
                <Photo
                  image={item.image}
                  onOpen={onOpen}
                  href={item.href}
                  linkLabel={`${item.linkLabel ?? '阅读原文'}：${item.title}`}
                />
              ) : null}
              <div className="sc-item-copy">
                {section.layout === 'timeline' ? (
                  <span className="sc-step" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                ) : null}
                {item.meta ? <span className="sc-item-meta">{item.meta}</span> : null}
                <h4>{item.title}</h4>
                {item.description ? <p>{item.description}</p> : null}
                {item.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {item.href ? (
                  item.href.startsWith('/') && !item.href.startsWith('//') ? (
                    <Link className="sc-text-link" to={item.href}>
                      {item.linkLabel ?? '了解更多'} <span aria-hidden="true">↗</span>
                    </Link>
                  ) : (
                    <a
                      className="sc-text-link"
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.linkLabel ?? '阅读原文'} <span aria-hidden="true">↗</span>
                    </a>
                  )
                ) : null}
              </div>
              {item.images?.length ? (
                <PhotoGallery images={item.images} title={item.title} onOpen={onOpen} />
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
  return (
    <section
      className={`sc-section sc-section--${section.layout}`}
      id={`showcase-${section.id}`}
      aria-labelledby={`showcase-${section.id}-title`}
    >
      <header className="sc-section-heading">
        <div>
          {section.eyebrow ? <p className="sc-eyebrow">{section.eyebrow}</p> : null}
          <h3 id={`showcase-${section.id}-title`}>{section.title}</h3>
        </div>
        <span className="sc-heading-spark" aria-hidden="true">
          ✳
        </span>
      </header>
      {section.introduction ? <p className="sc-section-intro">{section.introduction}</p> : null}
      {body}
    </section>
  );
}

function SubmittedShowcase({ content }: { content: ShowcaseContent }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  async function enterFullscreen() {
    if (!frame.current?.requestFullscreen) {
      setFullscreenError(true);
      return;
    }
    try {
      await frame.current.requestFullscreen();
      setFullscreenError(false);
    } catch {
      setFullscreenError(true);
    }
  }
  useEffect(() => {
    const resize = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data as { type?: unknown; height?: unknown } | null;
      if (
        message?.type !== 'showcase-size' ||
        typeof message.height !== 'number' ||
        !Number.isFinite(message.height)
      )
        return;
      setLoaded(true);
    };
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  useEffect(() => {
    const theme = () =>
      frame.current?.contentWindow?.postMessage(
        {
          type: 'showcase-theme',
          mode: document.body.classList.contains('theme-light') ? 'light' : 'dark',
        },
        '*',
      );
    const observer = new MutationObserver(theme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    theme();
    return () => observer.disconnect();
  }, [loaded, version]);
  if (!content.site) return null;
  return (
    <section className="sc-submitted-shell" aria-label={content.site.title}>
      <div className="sc-window-bar">
        <span className="sc-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{content.name}的小天地</span>
        <button
          type="button"
          onClick={() => {
            setVersion(version + 1);
            setLoaded(false);
          }}
          aria-label={`返回${content.name}展区首页`}
        >
          回到首页 ↺
        </button>
        <button
          type="button"
          onClick={() => {
            void enterFullscreen();
          }}
          aria-label={`全屏浏览${content.name}展区`}
        >
          全屏浏览 ⛶
        </button>
      </div>
      {fullscreenError ? (
        <p className="sc-window-tip" role="status">
          当前浏览器未能进入全屏，可继续在小窗中浏览。
        </p>
      ) : null}
      {!loaded ? (
        <p className="sc-frame-loading" role="status">
          小羊正在带路，马上就到…
        </p>
      ) : null}
      <iframe
        key={version}
        ref={frame}
        className="sc-submitted-frame"
        title={content.site.title}
        src={content.site.entry}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation"
        referrerPolicy="no-referrer"
        allow="fullscreen"
        onLoad={() => {
          setLoaded(true);
          frame.current?.contentWindow?.postMessage(
            {
              type: 'showcase-theme',
              mode: document.body.classList.contains('theme-light') ? 'light' : 'dark',
            },
            '*',
          );
        }}
      />
    </section>
  );
}

export function CuratedDepartmentShowcase({
  content,
  publicReview = false,
}: {
  content: ShowcaseContent;
  publicReview?: boolean;
}) {
  const [selected, setSelected] = useState<ShowcaseImage | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const photos = useMemo(() => {
    const images = [
      ...content.sections.flatMap((section) => [
        ...(section.images ?? []),
        ...(section.items ?? []).flatMap((item) => [item.image, ...(item.images ?? [])]),
      ]),
      content.hero,
    ].filter((image): image is ShowcaseImage => Boolean(image));
    return [...new Map(images.map((image) => [image.src, image])).values()];
  }, [content]);
  const selectedIndex = photos.findIndex((image) => image.src === selected?.src);
  const changePhoto = (step: number) =>
    setSelected(photos[(selectedIndex + step + photos.length) % photos.length] ?? null);
  const organizationKey = content.departmentId.split('.')[0];
  useEffect(() => {
    if (!selected || !dialog.current) return;
    dialog.current.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, [selected]);
  return (
    <div
      className={`curated-showcase sc-layout--${content.layout}${content.site ? ' sc-has-submitted-site' : ''}`}
      data-showcase={content.slug}
      style={contentStyle(content)}
    >
      <header className="sc-hero">
        <div className="sc-hero-copy">
          <p className="sc-eyebrow">{content.englishName}</p>
          <h2>{content.shortName ?? content.name}</h2>
          {content.shortName && content.shortName !== content.name ? (
            <p className="sc-formal-name">{content.name}</p>
          ) : null}
          <h3>{content.tagline}</h3>
          <p className="sc-hero-summary">{content.summary}</p>
          <div className="sc-hero-actions">
            <a className="sc-pill-link" href={content.site ? '#showcase-world' : '#showcase-about'}>
              一起逛逛 <span aria-hidden="true">↓</span>
            </a>
            <a className="sc-text-link" href="#showcase-contact">
              联系这个部门 ↗
            </a>
          </div>
        </div>
        <div className="sc-hero-character">
          <span className="sc-speech-bubble">嘿，欢迎来玩！</span>
          <OrganizationMark variant={organizationKey} />
          <span className="sc-hero-star" aria-hidden="true">
            ✦
          </span>
        </div>
        {content.hero && !content.site ? (
          <div className={`sc-hero-photo sc-hero-photo--${content.slug}`}>
            <Photo image={content.hero} onOpen={setSelected} hero />
          </div>
        ) : null}
      </header>
      {content.site ? (
        <div id="showcase-world">
          <SubmittedShowcase content={content} />
        </div>
      ) : (
        <>
          <nav className="sc-jump-nav" aria-label={`${content.name}内容导航`}>
            <a href="#showcase-about">认识我们</a>
            {content.sections.map((section) => (
              <a key={section.id} href={`#showcase-${section.id}`}>
                {section.title}
              </a>
            ))}
            {content.faq?.length ? <a href="#showcase-faq">你可能想问</a> : null}
          </nav>
          <section
            className={`sc-about${!content.logo && content.introduction.join('').length < 220 ? ' sc-about--compact' : ''}`}
            id="showcase-about"
            aria-label="部门介绍"
          >
            <div className="sc-about-copy">
              <span className="sc-sticker">认识一下</span>
              <h3>我们平时在忙什么？</h3>
              {content.logo ? (
                <img
                  className="sc-about-logo"
                  src={content.logo.src}
                  alt={content.logo.alt}
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
              {content.introduction.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <div className="sc-duty-board">
              <h4>我们的日常任务</h4>
              <ul>
                {content.duties.map((duty, index) => (
                  <li key={duty}>
                    <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <p>{duty}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          {content.sections.map((section) => (
            <SectionContent key={section.id} section={section} onOpen={setSelected} />
          ))}
          {content.faq?.length ? (
            <section
              className="sc-section sc-faq"
              id="showcase-faq"
              aria-labelledby="showcase-faq-title"
            >
              <header className="sc-section-heading">
                <h3 id="showcase-faq-title">你可能想问</h3>
                <span aria-hidden="true">?</span>
              </header>
              {content.faq.map((item) => (
                <details key={item.question}>
                  <summary>
                    {item.question}
                    <span aria-hidden="true">+</span>
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </section>
          ) : null}
        </>
      )}
      <footer className="sc-contact" id="showcase-contact" aria-labelledby="showcase-contact-title">
        <div className="sc-contact-copy">
          <span className="sc-sticker">下次，一起！</span>
          <h3 id="showcase-contact-title">
            一个问题，一点想法，
            <br />
            都可以成为相识的开始。
          </h3>
          {content.contactNote && !(publicReview && !content.contacts.length) ? (
            <p>{content.contactNote}</p>
          ) : null}
        </div>
        <div className="sc-contact-links">
          {content.contacts.map((contact) => (
            <a key={contact.email} href={`mailto:${contact.email}`} className="sc-email">
              <span>{contact.name}</span>
              <strong>{contact.email}</strong>
              <b aria-hidden="true">↗</b>
            </a>
          ))}
          {!publicReview &&
          !content.contacts.length &&
          content.departmentId === 'student_union.rights_development_center' ? (
            <Link className="sc-email" to="/information/proposals">
              <span>把想法说出来</span>
              <strong>前往公开提案池</strong>
              <b aria-hidden="true">↗</b>
            </Link>
          ) : null}
          <Link className="sc-back-link" to="/organizations">
            ← 再去其他部门逛逛
          </Link>
        </div>
      </footer>
      {selected ? (
        <dialog
          ref={dialog}
          className="sc-lightbox"
          aria-label={`图片预览：${selected.caption ?? selected.alt}`}
          onClose={() => setSelected(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) dialog.current?.close();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              changePhoto(event.key === 'ArrowRight' ? 1 : -1);
            }
          }}
        >
          <button
            type="button"
            className="sc-lightbox-close"
            onClick={() => dialog.current?.close()}
            aria-label="关闭大图"
          >
            ×
          </button>
          <figure>
            <img src={selected.src} alt={selected.alt} />
            <figcaption>{selected.caption ?? selected.alt}</figcaption>
          </figure>
          {photos.length > 1 ? (
            <nav className="sc-lightbox-navigation" aria-label="大图浏览">
              <button type="button" onClick={() => changePhoto(-1)} aria-label="上一张照片">
                ←
              </button>
              <span aria-live="polite">
                {selectedIndex + 1} / {photos.length}
              </span>
              <button type="button" onClick={() => changePhoto(1)} aria-label="下一张照片">
                →
              </button>
            </nav>
          ) : null}
        </dialog>
      ) : null}
    </div>
  );
}
