'use client';

import { useSyncExternalStore } from 'react';
import { onVoicesChanged, voicesReady } from './audio/voice';

/*
 * The voice list loads asynchronously and `voiceschanged` announces it, so
 * the store subscribes to that rather than assuming the first render knew.
 * The server has no `window.speechSynthesis`, and a value that differs
 * between the server render and the first client render is a hydration error
 * that takes the whole stage down. `useSyncExternalStore` exists for exactly
 * this: it renders `false` on the server and corrects on the client without
 * a mismatch, and without a setState inside an effect.
 */
const subscribe = (cb: () => void) => onVoicesChanged(cb);
const getSnapshot = () => voicesReady();
const getServerSnapshot = () => false;

/** Whether this browser can speak the commentary aloud: API plus real voices. */
export const useCanSpeak = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
