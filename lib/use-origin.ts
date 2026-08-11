'use client';

import { useSyncExternalStore } from 'react';

/**
 * The site's own origin, safely.
 *
 * The QR code has to carry an absolute URL, and `window` does not exist while
 * the page is being rendered on the server. `useSyncExternalStore` is the
 * supported way to read a browser-only value: it hands the server an empty
 * string and the browser the real one, without a hydration mismatch and
 * without setting state inside an effect.
 */
const subscribe = () => () => {};
const getSnapshot = () => window.location.origin;
const getServerSnapshot = () => '';

export function useOrigin(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
