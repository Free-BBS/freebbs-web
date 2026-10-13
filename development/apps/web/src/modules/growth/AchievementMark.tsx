import type { GrowthAchievement } from '@freebbs-development/contracts';

export function AchievementMark({ achievement }: { achievement: GrowthAchievement }) {
  const icon = achievement.icon ?? 'sprout';
  return (
    <svg
      className="growth-medal"
      data-series={achievement.series ?? 'milestone'}
      viewBox="0 0 100 112"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="growth-medal-ribbon"
        d="m29 72-6 32 16-9 11 12 4-31M71 72l6 32-16-9-11 12-4-31"
      />
      <circle className="growth-medal-face" cx="50" cy="49" r="33" />
      <circle cx="50" cy="49" r="27" stroke="currentColor" strokeWidth="1" opacity=".45" />
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path
          className="growth-medal-horns"
          d="M28 25c-12-12-20 0-13 8 5 5 12-1 8-5M72 25c12-12 20 0 13 8-5 5-12-1-8-5"
        />
        {icon === 'arts' ? (
          <>
            <path d="M45 58V36l17-4v21M45 42l17-4" />
            <ellipse cx="40" cy="58" rx="5" ry="4" />
            <ellipse cx="57" cy="53" rx="5" ry="4" />
          </>
        ) : icon === 'sports' ? (
          <>
            <circle cx="50" cy="49" r="15" />
            <path d="m44 45 8-3 6 6-3 8-9-1-2-10M52 42l3-7M58 48l7 2M55 56l1 7M46 55l-6 5M44 45l-6-5" />
          </>
        ) : icon === 'liaison' ? (
          <>
            <path d="m48 43 5-5a9 9 0 0 1 13 13l-7 7a9 9 0 0 1-13 0M52 55l-5 5a9 9 0 0 1-13-13l7-7a9 9 0 0 1 13 0M44 52l12-12" />
          </>
        ) : icon === 'rights' ? (
          <>
            <path d="m50 32 15 6v13c0 10-15 17-15 17s-15-7-15-17V38l15-6Z" />
            <path d="m43 49 5 5 10-12" />
          </>
        ) : icon === 'tuanwei' ? (
          <>
            <circle cx="50" cy="49" r="9" />
            <path d="M50 32v-4M50 66v4M33 49h-4M67 49h4M38 37l-3-3M62 61l3 3M62 37l3-3M38 61l-3 3" />
          </>
        ) : icon === 'sast' ? (
          <>
            <rect x="38" y="37" width="24" height="24" rx="4" />
            <rect x="44" y="43" width="12" height="12" rx="2" />
            <path d="M44 32v5M56 32v5M44 61v5M56 61v5M33 43h5M33 55h5M62 43h5M62 55h5" />
          </>
        ) : icon === 'tms' ? (
          <>
            <path d="M50 39c-6-5-13-7-20-5v27c7-2 14 0 20 5 6-5 13-7 20-5V34c-7-2-14 0-20 5ZM50 39v27M36 43l8 3M36 51l8 3M56 46l8-3M56 54l8-3" />
          </>
        ) : icon === 'compass' ? (
          <>
            <circle cx="50" cy="49" r="16" />
            <path d="m57 41-4 11-10 5 4-11 10-5Z" />
            <path d="M50 30v3M50 65v3M31 49h3M66 49h3" />
          </>
        ) : icon === 'calendar' ? (
          <>
            <rect x="35" y="35" width="30" height="29" rx="4" />
            <path d="M42 32v7M58 32v7M35 44h30M42 51h4M54 51h4M42 57h4M54 57h4" />
          </>
        ) : icon === 'spark' ? (
          <>
            <path d="m50 31 5 12 13 2-10 9 3 13-11-7-11 7 3-13-10-9 13-2 5-12Z" />
            <path d="m35 29 1 4 4 1-4 1-1 4-1-4-4-1 4-1 1-4Z" />
          </>
        ) : icon === 'trail' ? (
          <>
            <path d="M38 64c-12-12 30-10 21-20-7-8-27-1-22-10M40 66h20" />
            <circle cx="57" cy="31" r="5" />
            <path d="m43 57 3 3 6-7" />
          </>
        ) : icon === 'flag' ? (
          <>
            <path d="M40 66V32c9-8 17 8 26 0v20c-9 8-17-8-26 0M34 66h13" />
            <path d="m49 38 2 4 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1 2-4Z" />
          </>
        ) : icon === 'trophy' ? (
          <>
            <path d="M39 33h22v15c0 8-6 13-11 13s-11-5-11-13V33ZM39 37H31v7c0 7 6 10 11 10M61 37h8v7c0 7-6 10-11 10M50 61v8M41 69h18" />
            <path d="m50 38 2 4 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1 2-4Z" />
          </>
        ) : icon === 'orbit' ? (
          <>
            <circle cx="50" cy="49" r="5" />
            <ellipse cx="50" cy="49" rx="20" ry="8" transform="rotate(-35 50 49)" />
            <ellipse cx="50" cy="49" rx="20" ry="8" transform="rotate(35 50 49)" />
            <circle cx="65" cy="39" r="2" fill="currentColor" />
          </>
        ) : icon === 'rainbow' ? (
          <>
            <path d="M30 57v-5a20 20 0 0 1 40 0v5M36 57v-5a14 14 0 0 1 28 0v5M42 57v-5a8 8 0 0 1 16 0v5M28 62h18M54 62h18" />
          </>
        ) : icon === 'moon' ? (
          <>
            <path d="M56 33a17 17 0 1 0 12 23 14 14 0 0 1-12-23Z" />
            <path d="m65 32 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" />
          </>
        ) : icon === 'hourglass' ? (
          <>
            <path d="M36 32h28M36 66h28M39 32v8c0 5 6 6 11 9-5 3-11 4-11 9v8M61 32v8c0 5-6 6-11 9 5 3 11 4 11 9v8M43 38h14M43 61l7-6 7 6Z" />
          </>
        ) : (
          <>
            <path d="M50 65V46M50 50C36 51 34 39 35 35c12-1 17 5 15 15ZM50 44c0-12 8-15 16-15 0 11-7 17-16 15ZM41 65h18" />
          </>
        )}
      </g>
      <path d="m50 14 3 5h-6l3-5Z" fill="currentColor" />
    </svg>
  );
}
