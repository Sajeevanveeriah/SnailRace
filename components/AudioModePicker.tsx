'use client';

import type { AudioMode } from '@/lib/types';

/** Music, commentary, both, or nothing. One choice; the desk shows the same one. */
export function AudioModePicker({
  mode,
  canSpeak,
  onChange,
}: {
  mode: AudioMode;
  canSpeak: boolean;
  onChange: (mode: AudioMode) => void;
}) {
  const options: { id: AudioMode; label: string }[] = [
    { id: 'music', label: 'Music' },
    { id: 'commentary', label: 'Commentary' },
    { id: 'both', label: 'Both' },
    { id: 'off', label: 'Off' },
  ];
  return (
    <span className="seg" style={{ '--seg-n': options.length } as React.CSSProperties} role="group" aria-label="Audio">
      <span
        className="seg-thumb"
        style={{ '--seg-i': options.findIndex((o) => o.id === mode) } as React.CSSProperties}
        aria-hidden="true"
      />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={mode === o.id}
          disabled={(o.id === 'commentary' || o.id === 'both') && !canSpeak}
          title={(o.id === 'commentary' || o.id === 'both') && !canSpeak ? 'No voice is available on this device' : o.id === 'both' ? 'Music and commentary together' : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
