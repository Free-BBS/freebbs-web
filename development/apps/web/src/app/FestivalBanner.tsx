import { useState } from 'react';

import { BOYS_DAY_BANNER, type FestivalBannerMessage } from './festival-banner-content.js';

export interface FestivalBannerProps {
  enabled?: boolean;
  messages?: readonly FestivalBannerMessage[];
  /** Only local development previews show an empty placement. */
  preview?: boolean;
}

const PREVIEW_MESSAGE: FestivalBannerMessage = {
  id: 'boys-day-placement-preview',
  text: '男生节横幅展示位',
};

export function FestivalBanner({
  enabled = BOYS_DAY_BANNER.enabled,
  messages = BOYS_DAY_BANNER.messages,
  preview = import.meta.env.DEV,
}: FestivalBannerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const entries = messages.filter(({ text }) => text.trim().length > 0);
  const isPlaceholder = entries.length === 0;
  if (!enabled || (isPlaceholder && !preview)) return null;

  const banners = isPlaceholder ? [PREVIEW_MESSAGE] : entries;
  const selectedIndex = Math.max(
    0,
    banners.findIndex(({ id }) => id === selectedId),
  );
  const active = banners[selectedIndex]!;

  function showBanner(direction: number) {
    const nextIndex = (selectedIndex + direction + banners.length) % banners.length;
    setSelectedId(banners[nextIndex]!.id);
  }

  return (
    <section
      className="festival-banner"
      aria-label="男生节横幅"
      data-preview={isPlaceholder ? 'true' : undefined}
    >
      <span className="festival-banner-kicker">电子系 · 男生节</span>
      <div className="festival-banner-message" aria-live="polite" aria-atomic="true">
        <p className="festival-banner-text">{active.text}</p>
        {active.source?.trim() ? <p className="festival-banner-source">{active.source}</p> : null}
      </div>
      {banners.length > 1 ? (
        <nav className="festival-banner-controls" aria-label="横幅切换">
          <button type="button" aria-label="上一幅横幅" onClick={() => showBanner(-1)}>
            <span aria-hidden="true">←</span>
          </button>
          <span
            className="festival-banner-count"
            aria-label={`第 ${selectedIndex + 1} 幅，共 ${banners.length} 幅`}
          >
            {selectedIndex + 1} / {banners.length}
          </span>
          <button type="button" aria-label="下一幅横幅" onClick={() => showBanner(1)}>
            <span aria-hidden="true">→</span>
          </button>
        </nav>
      ) : null}
    </section>
  );
}
