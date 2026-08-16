'use client';

import { useSyncExternalStore } from 'react';
import { voiceAvailable } from './sound';

/* Speech support never changes for the life of a page, so there is nothing
   to subscribe to. */
const subscribe = () => () => {};
const getSnapshot = () => voiceAvailable();
/*
 * The server has no `window.speechSynthesis`, and a value that differs
 * between the server render and the first client render is a hydration error
 * that takes the whole stage down. `useSyncExternalStore` exists for exactly
 * this: it renders `false` on the server and corrects on the client without
 * a mismatch, and without a setState inside an effect.
 */
const getServerSnapshot = () => false;

/** Whether this browser can speak the commentary aloud. */
export const useCanSpeak = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
