'use client';

import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'system' | 'dark';

const STORAGE_KEY = 'ndcc-theme';
const MODES: ThemeMode[] = ['light', 'system', 'dark'];

/**
 * Light / System / Dark.
 *
 * The choice lives in localStorage and lands on <html data-theme="...">;
 * "system" is stored as no entry and rendered as no attribute, so the
 * prefers-color-scheme media query in globals.css does the deciding and the
 * page follows the OS live with no listener here.
 *
 * The mode is a tiny external store rather than component state so that
 * every toggle on the page (the stage header, the donate sheet) reads and
 * writes the same value and moves together.
 */
const listeners = new Set<() => void>();

function currentMode(): ThemeMode {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/* The server cannot know the saved choice; it renders "system" and the
   client corrects the thumb immediately after hydration. The page colours
   themselves never flash, because the inline script in layout.tsx has
   already set data-theme before first paint. */
const getServerSnapshot = (): ThemeMode => 'system';

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function setThemeMode(next: ThemeMode) {
  const root = document.documentElement;

  /* Cross-fade the whole page once, then drop the class so the per-element
     transitions defined in the stylesheet take back over. */
  root.classList.add('theme-anim');
  window.setTimeout(() => root.classList.remove('theme-anim'), 500);

  if (next === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = next;
  }

  try {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* Private browsing. The in-page choice above still applies. */
  }

  for (const l of listeners) l();
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, currentMode, getServerSnapshot);

  return (
    <span className={`seg ${className}`} role="group" aria-label="Appearance">
      <span
        className="seg-thumb"
        style={{ '--seg-i': MODES.indexOf(mode) } as React.CSSProperties}
        aria-hidden="true"
      />
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setThemeMode(m)}
          title={m === 'system' ? 'Follow this device’s appearance' : `Always ${m}`}
        >
          {m === 'light' ? <SunIcon /> : m === 'dark' ? <MoonIcon /> : <AutoIcon />}
          <span className="hidden sm:inline">
            {m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'Auto'}
          </span>
        </button>
      ))}
    </span>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.4 14.2A8.4 8.4 0 0 1 9.8 3.6a8.4 8.4 0 1 0 10.6 10.6Z" />
    </svg>
  );
}

function AutoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.8" y="4.2" width="18.4" height="12.6" rx="2.4" />
      <path d="M8.5 20.5h7" />
    </svg>
  );
}
