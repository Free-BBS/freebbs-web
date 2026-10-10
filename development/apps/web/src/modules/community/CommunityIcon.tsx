export function CommunityIcon({
  name,
}: {
  name: 'pen' | 'heart' | 'reply' | 'arrow' | 'spark' | 'stage' | 'lock' | 'fire';
}) {
  const paths = {
    pen: (
      <>
        <path d="m15 4 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" />
        <path d="M13 20h7" />
      </>
    ),
    heart: (
      <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />
    ),
    reply: (
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 10.2 10.2 0 0 1-4-.8L3 21l1.8-5a8.4 8.4 0 0 1-.8-4A8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z" />
    ),
    arrow: (
      <>
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </>
    ),
    stage: (
      <>
        <path d="M3 3h18v18H3Zm0 3c3 1 4 5 4 10M21 6c-3 1-4 5-4 10M3 17h18" />
        <path d="M9 21v-4m6 4v-4" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    fire: (
      <path d="M13 3c1 5-4 6-4 9 0 1 .5 2 2 3-1-4 3-4 4-7 3 3 5 6 5 8a8 8 0 0 1-16 0c0-3 2-6 4-8 0 3 1 3 1 3 0-4 4-5 4-8Z" />
    ),
  };
  return (
    <svg
      className="community-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
