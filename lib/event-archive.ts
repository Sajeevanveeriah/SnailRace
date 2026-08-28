'use client';

import { sha256Hex } from './audit';
import type { EventState } from './types';

/**
 * Archived nights.
 *
 * A club runs many nights on one laptop. When the operator starts a brand
 * new event, the finished night is snapshotted here - state, audit chain and
 * all - so nothing is lost and no two nights ever share state. Each snapshot
 * carries an integrity hash computed at save time.
 */

const KEY = 'ndcc-snailrace-nights-v1';
/** How many archived nights the laptop keeps. Oldest falls off first. */
const CAP = 12;

export interface ArchivedNight {
  id: string;
  name: string;
  savedAt: number;
  rehearsal: boolean;
  races: number;
  integrity: string;
  state: EventState;
}

export function listNights(): ArchivedNight[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ArchivedNight[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Snapshot a night. Returns false when storage refuses (quota, privacy). */
export async function archiveNight(state: EventState): Promise<boolean> {
  try {
    const canonical = JSON.stringify(state);
    const night: ArchivedNight = {
      id: `${state.eventId}-${Date.now().toString(36)}`,
      name: `${state.eventName} (${state.history.filter((h) => !h.void).length} races)`,
      savedAt: Date.now(),
      rehearsal: state.rehearsal,
      races: state.history.filter((h) => !h.void).length,
      integrity: await sha256Hex(canonical),
      state: JSON.parse(canonical) as EventState,
    };
    const next = [night, ...listNights()].slice(0, CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function removeNight(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listNights().filter((n) => n.id !== id)));
  } catch {
    /* nothing to remove or nowhere to write */
  }
}

/** Verify a snapshot's integrity hash. */
export async function verifyNight(night: ArchivedNight): Promise<boolean> {
  return (await sha256Hex(JSON.stringify(night.state))) === night.integrity;
}
