/**
 * The racer.
 *
 * Drawn rather than sprited so it stays crisp on a projector at any lane
 * height and recolours per lane from CSS custom properties alone. The nose
 * sits at x=122 of a 132-wide viewBox; `NOSE` in the track geometry depends on
 * that number, so move one and move the other.
 */
export function Snail({ className = '' }: { className?: string }) {
  return (
    <svg className={`sn ${className}`} viewBox="0 0 132 84" aria-hidden="true" focusable="false">
      <ellipse className="sn-shadow" cx="66" cy="77" rx="46" ry="5" />
      <path
        className="sn-foot"
        d="M9 73 C7 61 19 57 33 57 H88 C96 57 100 53 104 47 L112 35 C116 29 125 30 127 37 C129 44 124 48 121 53 L113 65 C106 75 94 78 80 78 H23 C13 78 9 77 9 73 Z"
      />
      <path className="sn-mouth" d="M119 57 q6 2 9 -2" />
      <g className="sn-head">
        <path className="sn-stalk" d="M116 40 C118 28 116 21 113 15" />
        <path className="sn-stalk" d="M106 44 C104 34 100 28 96 23" />
        <circle className="sn-eye" cx="112" cy="12" r="5" />
        <circle className="sn-eye" cx="94" cy="20" r="5" />
        <circle className="sn-pupil" cx="114" cy="11" r="2.1" />
        <circle className="sn-pupil" cx="96" cy="19" r="2.1" />
      </g>
      <g className="sn-shell">
        <circle className="sn-shell-base" cx="52" cy="34" r="27" />
        <path
          className="sn-spiral"
          d="M52 34 a5 5 0 1 0 4.6 3 a11 11 0 1 1 -14.4 -6.6 a17.5 17.5 0 1 1 -3.4 25"
        />
        <circle className="sn-shell-rim" cx="52" cy="34" r="27" />
        <ellipse className="sn-gloss" cx="42" cy="21" rx="8" ry="5" />
      </g>
    </svg>
  );
}
