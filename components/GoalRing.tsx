'use client';

import { moneyShort } from '@/lib/money';

/**
 * Progress towards tonight's target.
 *
 * A ring rather than a bar because it holds its shape at any width on the
 * stage header, and the stroke animates from a single `stroke-dashoffset`
 * transition rather than a layout-affecting width change.
 */
export function GoalRing({
  raisedCents,
  goalCents,
  size = 92,
}: {
  raisedCents: number;
  goalCents: number;
  size?: number;
}) {
  const pct = goalCents > 0 ? Math.min(1, raisedCents / goalCents) : 0;
  const r = size / 2 - 7;
  const circumference = 2 * Math.PI * r;
  const reached = pct >= 1;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-label={`Tonight's target, ${moneyShort(raisedCents)} of ${moneyShort(goalCents)}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="7"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={reached ? '#b7e43b' : '#2997ff'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          style={{
            transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16,1,0.3,1), stroke 0.4s ease',
            filter: reached ? 'drop-shadow(0 0 10px rgba(183,228,59,0.8))' : undefined,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-none">
        <div>
          <p className="num text-base font-bold">{Math.round(pct * 100)}%</p>
          <p className="text-[9px] uppercase tracking-[0.16em] text-white/45">of goal</p>
        </div>
      </div>
    </div>
  );
}
