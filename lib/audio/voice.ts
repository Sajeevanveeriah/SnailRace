'use client';

import { duck } from './music';
import { getLevels } from './engine';
import { type RecordedCue, clipFile, recordedCueFor, takesFor } from './voice-cues';

export type CallPriority = 'big' | 'call' | 'finish';
export interface VoiceChoice { uri: string; name: string; lang: string; local: boolean }

/**
 * The same cue inside this window is dropped: a caller does not say "there's
 * a move" twice in twenty seconds, even with different words. The finish is
 * exempt, it is the one line the room must always hear.
 */
const SAME_CUE_WINDOW_MS = 25_000;
/** Duck depth under a clip, and the duck length used until the clip reports its own. */
const CLIP_DUCK_DEPTH = 0.45;
const CLIP_DUCK_FALLBACK_S = 3;

let enabled = false;
let voice: SpeechSynthesisVoice | null = null;
let preferredVoiceURI = 'recorded';
let loaded = false;
let generation = 0;
let speaking = false;
let audio: HTMLAudioElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: { text: string; priority: CallPriority; cue?: RecordedCue; at: number } | null = null;
let lastEndedAt = -Infinity;
/** When each cue last played, so an intervening cue cannot reset the window. */
const lastCueAt = new Map<string, number>();
/** Last take played per cue, so a cue never repeats its wording back to back. */
const lastTake = new Map<string, number>();
const listeners = new Set<() => void>();

const synth = () => typeof window !== 'undefined' ? window.speechSynthesis ?? null : null;
export const voiceAvailable = () => typeof window !== 'undefined' && typeof Audio !== 'undefined';
export const voicesReady = voiceAvailable;

export function onVoicesChanged(cb: () => void): () => void {
  listeners.add(cb);
  synth()?.addEventListener('voiceschanged', cb);
  return () => { listeners.delete(cb); synth()?.removeEventListener('voiceschanged', cb); };
}

export function initVoice(): void {
  if (!loaded && typeof window !== 'undefined') {
    try { preferredVoiceURI = window.localStorage.getItem('ndcc-commentary-voice') || 'recorded'; } catch { /* Tab preference works without storage. */ }
    loaded = true;
  }
  voice = synth()?.getVoices().find((item) => item.voiceURI === preferredVoiceURI) ?? null;
}

export function voiceChoices(): VoiceChoice[] {
  return [
    { uri: 'recorded', name: 'Natural race caller', lang: 'English', local: true },
    ...(synth()?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('en'))
      .sort((a, b) => Number(/natural|neural|premium|enhanced/i.test(b.name)) - Number(/natural|neural|premium|enhanced/i.test(a.name)))
      .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService })),
  ];
}
export const selectedVoiceURI = () => voice?.voiceURI ?? preferredVoiceURI;
export function selectVoice(uri: string): void {
  silence();
  preferredVoiceURI = uri;
  loaded = true;
  try { window.localStorage.setItem('ndcc-commentary-voice', uri); } catch { /* Optional preference. */ }
  initVoice();
  listeners.forEach((cb) => cb());
}
export function setVoiceEnabled(on: boolean): void { enabled = on; if (on) initVoice(); else silence(); }
export const isVoiceEnabled = () => enabled;

/** Invalidate old callbacks before cancelling either playback backend. */
export function silence(): void {
  generation++;
  pending = null;
  clearTimeout(timer);
  timer = undefined;
  audio?.pause();
  audio = null;
  speaking = false;
  lastEndedAt = -Infinity;
  lastCueAt.clear();
  try { synth()?.cancel(); } catch { /* Cancellation is best effort. */ }
}

/**
 * A random take of the cue, never the one that played last time for the
 * same cue. With a single recorded take there is nothing to vary.
 */
export function pickTake(cue: RecordedCue, rnd: () => number = Math.random): number {
  const takes = takesFor(cue);
  if (takes < 2) return 1;
  const previous = lastTake.get(cue) ?? 0;
  let take = 1 + Math.floor(rnd() * takes);
  if (take === previous) take = (take % takes) + 1;
  lastTake.set(cue, take);
  return take;
}

function speak(text: string, priority: CallPriority, cue?: RecordedCue): boolean {
  const token = ++generation;
  speaking = true;
  const complete = () => {
    if (token !== generation) return;
    clearTimeout(timer);
    timer = undefined;
    speaking = false;
    audio = null;
    lastEndedAt = Date.now();
    const next = pending;
    pending = null;
    if (next && Date.now() - next.at < 3500) {
      timer = setTimeout(() => {
        timer = undefined;
        if (token === generation && enabled) speak(next.text, next.priority, next.cue);
      }, 350);
    }
  };
  try {
    initVoice();
    if (preferredVoiceURI === 'recorded' || !voice) {
      const id = cue ?? recordedCueFor(text);
      if (!id) { speaking = false; return false; }
      if (Date.now() - (lastCueAt.get(id) ?? -Infinity) < SAME_CUE_WINDOW_MS && priority !== 'finish') { speaking = false; return false; }
      lastCueAt.set(id, Date.now());
      const clip = new Audio(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/audio/commentary/${clipFile(id, pickTake(id))}`);
      audio = clip;
      clip.volume = getLevels().master;
      clip.onended = complete;
      clip.onerror = complete;
      /* Duck the music for as long as the clip actually runs. The length is
         only known once the metadata arrives, so start with a short duck and
         extend it to the real duration when the clip reports one. */
      duck(CLIP_DUCK_FALLBACK_S, CLIP_DUCK_DEPTH);
      clip.onloadedmetadata = () => {
        if (token !== generation) return;
        const seconds = clip.duration;
        if (Number.isFinite(seconds) && seconds > 0) duck(seconds + 0.3, CLIP_DUCK_DEPTH);
      };
      void clip.play().catch(complete);
    } else {
      const utterance = new SpeechSynthesisUtterance(text.replace(/\s+-\s+/g, ', ').trim());
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = getLevels().master;
      utterance.onend = complete;
      utterance.onerror = complete;
      duck(Math.max(3, text.split(/\s+/).length / 2.5), 0.2);
      synth()?.speak(utterance);
    }
    // A broken browser callback must not strand the caller indefinitely.
    timer = setTimeout(() => {
      if (token !== generation) return;
      audio?.pause();
      try { synth()?.cancel(); } catch { /* Continue without audio. */ }
      complete();
    }, 15000);
    return true;
  } catch { complete(); return false; }
}

/** One active line and at most one fresh priority call, never a speech backlog. */
export function say(text: string, priority: CallPriority = 'call', cue?: RecordedCue): boolean {
  if (!enabled || !voiceAvailable() || !text.trim()) return false;
  if (priority === 'finish') {
    silence();
    return speak(text, priority, cue);
  }
  if (speaking || timer) {
    if (priority === 'big') pending = { text, priority, cue, at: Date.now() };
    return false;
  }
  if (priority === 'call' && Date.now() - lastEndedAt < 1500) return false;
  return speak(text, priority, cue);
}

export function previewVoice(): boolean {
  silence();
  return speak('The field is ready. Let us get this race started.', 'big', 'ready');
}
