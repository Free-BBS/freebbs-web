import { existsSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CuratedDepartmentShowcase } from './CuratedDepartmentShowcase.js';
import { SHOWCASES, findShowcase } from './registry.js';
import type { ShowcaseContent, ShowcaseImage } from './types.js';

const native = SHOWCASES.filter((content) => !content.site);
const submitted = SHOWCASES.filter((content) => content.site);
const publicRoot = path.resolve(process.cwd(), 'apps/web/public');
const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal',
);
const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeAll(() => {
  // jsdom has no native dialog implementation; the browser owns these two actions.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
});
afterAll(() => {
  if (showModalDescriptor)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModalDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (closeDescriptor) Object.defineProperty(HTMLDialogElement.prototype, 'close', closeDescriptor);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

function show(content: ShowcaseContent) {
  return render(
    <MemoryRouter>
      <CuratedDepartmentShowcase content={content} />
    </MemoryRouter>,
  );
}
function contentImages(content: ShowcaseContent): ShowcaseImage[] {
  return [
    ...(content.hero ? [content.hero] : []),
    ...(content.logo ? [content.logo] : []),
    ...content.sections.flatMap((section) => [
      ...(section.images ?? []),
      ...(section.items ?? []).flatMap((item) => [
        ...(item.image ? [item.image] : []),
        ...(item.images ?? []),
      ]),
    ]),
  ];
}
function localAsset(src: string) {
  expect(src).toMatch(/^\/development\/organization-showcase\//);
  const resolved = path.resolve(publicRoot, src.replace(/^\/development\//, ''));
  expect(path.relative(publicRoot, resolved)).not.toMatch(/^\.\./);
  return resolved;
}

describe('curated organization exhibitions', () => {
  it('ships fourteen exhibitions and every registered image and site entry inside repository public assets', () => {
    expect(SHOWCASES).toHaveLength(14);
    expect(native).toHaveLength(7);
    expect(submitted).toHaveLength(7);
    for (const content of SHOWCASES) {
      for (const image of contentImages(content)) {
        expect(image.alt.trim()).not.toBe('');
        expect(existsSync(localAsset(image.src)), image.src).toBe(true);
      }
      if (content.site)
        expect(existsSync(localAsset(content.site.entry)), content.site.entry).toBe(true);
    }
    expect(new Set(native.flatMap(contentImages).map(({ src }) => src)).size).toBe(44);
  });

  it.each(native)(
    'retains $name introduction, duties, sections, and original email destinations',
    (content) => {
      show(content);
      expect(
        screen.getByRole('heading', { name: content.shortName ?? content.name, level: 2 }),
      ).toBeInTheDocument();
      const about = screen.getByRole('region', { name: '部门介绍' });
      for (const paragraph of content.introduction)
        expect(within(about).getByText(paragraph)).toBeInTheDocument();
      for (const duty of content.duties) expect(within(about).getByText(duty)).toBeInTheDocument();
      for (const section of content.sections)
        expect(screen.getByRole('region', { name: section.title })).toBeInTheDocument();
      for (const contact of content.contacts) {
        expect(
          screen.getByRole('link', {
            name: new RegExp(contact.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          }),
        ).toHaveAttribute('href', `mailto:${contact.email}`);
      }
      expect(screen.queryByText('部门主页正在准备中。')).not.toBeInTheDocument();
      for (const note of content.sourceNotes)
        expect(screen.queryByText(note)).not.toBeInTheDocument();
    },
  );

  it('preserves both sports albums with all sixteen captions and opens and closes full-size photos', () => {
    const content = findShowcase('student_union.sports_center')!;
    show(content);
    for (const section of content.sections) {
      const album = screen.getByRole('region', { name: section.title });
      expect(within(album).getAllByRole('img')).toHaveLength(8);
      for (const image of section.images!)
        expect(within(album).getByText(image.caption!)).toBeInTheDocument();
    }
    const first = content.sections[0].images![0];
    fireEvent.click(screen.getByRole('button', { name: `查看大图：${first.caption}` }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('img', { name: first.alt })).toHaveAttribute('src', first.src);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭大图' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('keeps the TMS formal name, all year-round activities, cover, and seven expandable questions', () => {
    const content = findShowcase('tms.position')!;
    show(content);
    expect(screen.getByRole('heading', { name: '电子系 TMS 分会', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(content.name, { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: content.logo!.alt })).toHaveAttribute(
      'src',
      content.logo!.src,
    );
    for (const item of content.sections[0].items!)
      expect(screen.getByRole('heading', { name: item.title, level: 4 })).toBeInTheDocument();
    const faq = screen.getByRole('region', { name: '你可能想问' });
    expect(faq.querySelectorAll('details')).toHaveLength(7);
    for (const item of content.faq!) {
      const summary = within(faq).getByText(item.question);
      const details = summary.closest('details')!;
      expect(details).not.toHaveAttribute('open');
      fireEvent.click(summary);
      expect(details).toHaveAttribute('open');
      expect(within(details).getByText(item.answer)).toBeVisible();
    }
  });

  it('cycles through all five rights photos in both directions and offers the real public proposal destination', () => {
    const content = findShowcase('student_union.rights_development_center')!;
    const photos = content.sections.find(({ layout }) => layout === 'carousel')!.images!;
    show(content);
    const carousel = screen.getByRole('group', { name: '权发掠影照片相册' });
    for (let index = 0; index < photos.length; index++) {
      expect(within(carousel).getByRole('img')).toHaveAttribute('src', photos[index].src);
      expect(within(carousel).getByRole('status')).toHaveTextContent(`${index + 1} / 5`);
      fireEvent.click(within(carousel).getByRole('button', { name: '权发掠影下一张照片' }));
    }
    expect(within(carousel).getByRole('img')).toHaveAttribute('src', photos[0].src);
    fireEvent.click(within(carousel).getByRole('button', { name: '权发掠影上一张照片' }));
    expect(within(carousel).getByRole('img')).toHaveAttribute('src', photos[4].src);
    expect(within(carousel).getByRole('img')).toHaveStyle({ objectFit: 'contain' });
    expect(screen.getByRole('link', { name: /前往公开提案池/ })).toHaveAttribute(
      'href',
      '/information/proposals',
    );
    expect(screen.queryByText(/公开投稿.*提供联系邮箱/)).not.toBeInTheDocument();
  });

  it('keeps the six new-media article destinations, matching cover images, and safe external navigation', () => {
    const content = findShowcase('media_center.new_media_reporters')!;
    show(content);
    const items = content.sections.flatMap(({ items }) => items ?? []).filter(({ href }) => href);
    expect(items).toHaveLength(6);
    for (const item of items) {
      const article = screen
        .getByRole('heading', { name: item.title, level: 4 })
        .closest('article')!;
      const links = within(article).getAllByRole('link');
      expect(links).toHaveLength(2);
      for (const link of links) {
        expect(link).toHaveAttribute('href', item.href);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      }
      expect(
        within(article).getByRole('link', { name: `${item.linkLabel}：${item.title}` }),
      ).toContainElement(within(article).getByRole('img'));
      expect(within(article).queryByRole('button')).not.toBeInTheDocument();
      expect(within(article).getByRole('img')).toHaveAttribute('src', item.image!.src);
      expect(within(article).getByRole('img')).toHaveStyle({ objectFit: 'contain' });
    }
  });

  it('retains all seven freshman photographs and the volunteer recruitment link without fabricating missing images', () => {
    const freshman = findShowcase('youth_league.freshman')!;
    const view = show(freshman);
    for (const src of new Set(contentImages(freshman).map(({ src }) => src))) {
      expect(screen.getAllByRole('img').some((image) => image.getAttribute('src') === src)).toBe(
        true,
      );
    }
    expect(new Set(contentImages(freshman).map(({ src }) => src)).size).toBe(7);
    view.unmount();
    const volunteer = findShowcase('youth_league.volunteer')!;
    show(volunteer);
    expect(screen.getByRole('link', { name: /^阅读招新推送/ })).toHaveAttribute(
      'href',
      'https://mp.weixin.qq.com/s/0s4SQgKZ1Ft-L9R_GZQvgQ',
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAccessibleName(/小羊/);
  });

  it.each(submitted)(
    'isolates the $name submitted site without granting same-origin access',
    (content) => {
      show(content);
      const frame = screen.getByTitle(content.site!.title);
      expect(frame).toHaveAttribute('src', content.site!.entry);
      expect(frame.getAttribute('sandbox')?.split(' ')).toContain('allow-scripts');
      expect(frame.getAttribute('sandbox')?.split(' ')).not.toContain('allow-same-origin');
      expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
      expect(screen.queryByLabelText('选择 HTML 文件')).not.toBeInTheDocument();
    },
  );

  it('accepts ready messages only from the active frame and ignores invalid or stale-frame messages after returning home', () => {
    const content = findShowcase('youth_league.research')!;
    show(content);
    const frame = screen.getByTitle(content.site!.title) as HTMLIFrameElement;
    expect(screen.getByText('小羊正在带路，马上就到…')).toBeInTheDocument();
    fireEvent(
      window,
      new MessageEvent('message', {
        source: window,
        data: { type: 'showcase-size', height: 2500 },
      }),
    );
    expect(screen.getByText('小羊正在带路，马上就到…')).toBeInTheDocument();
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'showcase-size', height: Number.POSITIVE_INFINITY },
      }),
    );
    expect(screen.getByText('小羊正在带路，马上就到…')).toBeInTheDocument();
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'showcase-size', height: 2500 },
      }),
    );
    expect(screen.queryByText('小羊正在带路，马上就到…')).not.toBeInTheDocument();
    const oldSource = frame.contentWindow;
    fireEvent.click(screen.getByRole('button', { name: '返回调研组展区首页' }));
    const current = screen.getByTitle(content.site!.title) as HTMLIFrameElement;
    expect(current).not.toBe(frame);
    expect(current).toHaveAttribute('src', content.site!.entry);
    fireEvent(
      window,
      new MessageEvent('message', {
        source: oldSource,
        data: { type: 'showcase-size', height: 2500 },
      }),
    );
    expect(screen.getByText('小羊正在带路，马上就到…')).toBeInTheDocument();
    fireEvent.load(current);
    expect(screen.queryByText('小羊正在带路，马上就到…')).not.toBeInTheDocument();
  });

  it('offers fullscreen on request and retains the usable embedded site if fullscreen is rejected', async () => {
    const content = findShowcase('youth_league.research')!;
    show(content);
    const frame = screen.getByTitle(content.site!.title) as HTMLIFrameElement;
    expect(frame).toHaveAttribute('allow', 'fullscreen');
    const requestFullscreen = vi.fn().mockRejectedValue(new Error('Fullscreen denied'));
    Object.defineProperty(frame, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    fireEvent.click(screen.getByRole('button', { name: '全屏浏览调研组展区' }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/当前浏览器未能进入全屏，可继续在小窗中浏览/),
    ).toBeInTheDocument();
    expect(frame).toBeInTheDocument();
  });
});
