import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  burstId: number;
  kind: 'fireworks' | 'blessing';
}

const blooms = [
  { left: '15%', top: '30%' },
  { left: '37%', top: '16%' },
  { left: '66%', top: '18%' },
  { left: '86%', top: '35%' },
];

/** A short local effect; CSS provides a still alternative for reduced motion. */
export function BannerCelebration({ burstId, kind }: Props) {
  const [active, setActive] = useState<{ burstId: number; kind: Props['kind'] } | null>(null);
  useEffect(() => {
    if (burstId <= 0) {
      setActive(null);
      return;
    }
    setActive({ burstId, kind });
    const timer = setTimeout(() => setActive(null), 1800);
    return () => clearTimeout(timer);
  }, [burstId, kind]);
  if (!active) return null;
  return (
    <div
      key={active.burstId}
      className={`banner-celebration banner-celebration--${active.kind}`}
      aria-hidden="true"
      data-testid="banner-celebration"
    >
      <span className="banner-celebration-still">{active.kind === 'blessing' ? '♥' : '✦'}</span>
      {active.kind === 'fireworks'
        ? blooms.map((bloom, index) => (
            <span
              className="banner-firework"
              key={index}
              style={{ ...bloom, '--bloom-delay': `${index * 85}ms` } as CSSProperties}
            >
              {Array.from({ length: 8 }, (_, ray) => (
                <i
                  key={ray}
                  style={
                    {
                      '--spark-angle': `${ray * 45}deg`,
                      '--spark-color': ['#fff2bd', '#ffffff', '#ffd5e5'][ray % 3],
                    } as CSSProperties
                  }
                />
              ))}
            </span>
          ))
        : Array.from({ length: 7 }, (_, index) => (
            <span
              className="banner-blessing-heart"
              key={index}
              style={
                { left: `${10 + index * 13}%`, '--heart-delay': `${index * 60}ms` } as CSSProperties
              }
            >
              ♥
            </span>
          ))}
    </div>
  );
}
