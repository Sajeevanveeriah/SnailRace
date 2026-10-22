'use client';

import { duck, VOICE_DUCK, VOICE_DUCK_ATTACK, VOICE_DUCK_RELEASE } from './music';
import { getLevels } from './engine';
import { type RecordedCue, clipFile, recordedCueFor, takesFor } from './voice-cues';

export type CallPriority = 'big' | 'call' | 'finish';
export interface VoiceChoice { uri: string; name: string; lang: string; local: boolean }

/** How a line may be said. */
export interface SayOptions {
  /** Only these takes of the cue say the same thing as the caption. */
  takes?: readonly number[];
  /**
   * A twist's hit or a change of lead. It may fade out a minor call that is
   * still talking, and a twist may use a different take of a cue heard a
   * moment ago: every twist gets its line.
   */
  preempt?: boolean;
  twist?: boolean;
  /**
   * Where the line sits in the caller's order of importance, `CALL_RANK` in
   * `use-race`: 0 is a change of lead, 2 a twist's own line, 3 and above the
   * minor calls (laps, sectors, fillers). A queued minor call is dropped when
   * a more important one lands, and a line on air that is minor is cut by one
   * that may pre-empt.
   */
  rank?: number;
}

/**
 * The identical take is not heard twice inside this window: a caller does
 * not repeat a sentence word for word inside twenty-five seconds. The finish
 * is exempt, it is the one line the room must always hear.
 */
export const SAME_TAKE_WINDOW_MS = 25_000;
/** A different take of the same cue may follow after this long. */
export const SAME_CUE_GAP_MS = 8_000;
/** A clip is never cut off mid-word: it fades over this long instead. */
export const CLIP_FADE_MS = 300;
/** The winner call waits for a big call that will be done inside this long. */
export const FINISH_WAIT_MS = 1_500;
/** Duck length used until the clip reports its own. */
const CLIP_DUCK_FALLBACK_S = 3;
/**
 * The queue holds one line, and only for this long. A caption goes on the
 * strap the moment its line is offered; if the line on air has not finished
 * by then the room has read the strap and the voice would be answering a
 * caption that has moved on (the audit heard a retirement 2.7 s late).
 */
export const QUEUE_MAX_WAIT_MS = 800;
/** The breath between a line ending and the queued one starting. */
export const QUEUE_GAP_MS = 250;
/** Ranks from here up are minor calls: a lead change or a twist may cut them. */
export const MINOR_RANK = 3;
/** A line offered without a rank: ordinary when big, minor when not. */
const rankOf = (priority: CallPriority, opts: SayOptions): number =>
  opts.rank ?? (priority === 'big' ? MINOR_RANK - 1 : MINOR_RANK + 3);

let enabled = false;
let voice: SpeechSynthesisVoice | null = null;
let preferredVoiceURI = 'recorded';
let loaded = false;
let generation = 0;
let speaking = false;
let audio: HTMLAudioElement | null = null;
/** The line on air, or the one about to go on air after a fade. */
let current: { priority: CallPriority; rank: number; startedAt: number } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: { text: string; priority: CallPriority; cue?: RecordedCue; at: number; opts: SayOptions; rank: number } | null = null;
/** A winner call waiting for the run-home call to finish its sentence. */
let afterCurrent: { text: string; cue?: RecordedCue } | null = null;
let lastEndedAt = -Infinity;
/** When each cue last played, any take. */
const lastCueAt = new Map<string, number>();
/** When each take last played, as `cue#take`. */
const lastTakeAt = new Map<string, number>();
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

/**
 * Bring a clip down to nothing over `ms`, then stop it. Pausing a clip
 * outright cuts the caller off mid-word, which on a PA sounds like a fault.
 */
export function fadeOutClip(clip: HTMLAudioElement | null, ms = CLIP_FADE_MS): void {
  if (!clip) return;
  clip.onended = null;
  clip.onerror = null;
  const from = Number.isFinite(clip.volume) ? clip.volume : 1;
  const steps = 6;
  for (let step = 1; step <= steps; step++) {
    setTimeout(() => {
      try {
        clip.volume = Math.max(0, from * (1 - step / steps));
        if (step === steps) clip.pause();
      } catch { /* The element may already be gone. */ }
    }, (ms * step) / steps);
  }
}

/** Stop whatever is talking: invalidate its callbacks and fade it out. */
function stopCurrent(): void {
  generation++;
  clearTimeout(timer);
  timer = undefined;
  fadeOutClip(audio);
  audio = null;
  current = null;
  speaking = false;
  try { synth()?.cancel(); } catch { /* Cancellation is best effort. */ }
}

/** Invalidate old callbacks before cancelling either playback backend. */
export function silence(): void {
  stopCurrent();
  pending = null;
  afterCurrent = null;
  lastEndedAt = -Infinity;
  lastCueAt.clear();
  lastTakeAt.clear();
}

/** How much longer the line on air will talk, in milliseconds; 0 when quiet. */
export function voiceBusyMs(): number {
  if (!speaking) return 0;
  const clip = audio;
  if (clip && Number.isFinite(clip.duration) && clip.duration > 0) {
    return Math.max(0, (clip.duration - (clip.currentTime || 0)) * 1000);
  }
  return current ? Math.max(0, CLIP_DUCK_FALLBACK_S * 1000 - (Date.now() - current.startedAt)) : 0;
}

/**
 * A random take of the cue: never the one that played last for that cue,
 * never one heard in the last 25 seconds, and only from `allowed` when the
 * caption needs particular words. 0 when no take is free.
 */
export function pickTake(
  cue: RecordedCue,
  rnd: () => number = Math.random,
  allowed?: readonly number[],
  now = Date.now(),
): number {
  const takes = takesFor(cue);
  const all = Array.from({ length: takes }, (_, index) => index + 1);
  const pool = allowed?.length ? all.filter((take) => allowed.includes(take)) : all;
  if (!pool.length) return 0;
  const previous = lastTake.get(cue) ?? 0;
  const fresh = pool.filter((take) => now - (lastTakeAt.get(`${cue}#${take}`) ?? -Infinity) >= SAME_TAKE_WINDOW_MS);
  const choices = fresh.length > 1 ? fresh.filter((take) => take !== previous) : fresh;
  if (!choices.length) return 0;
  const take = choices[Math.floor(rnd() * choices.length)];
  lastTake.set(cue, take);
  return take;
}

function speak(text: string, priority: CallPriority, cue?: RecordedCue, opts: SayOptions = {}): boolean {
  const token = ++generation;
  speaking = true;
  current = { priority, rank: rankOf(priority, opts), startedAt: Date.now() };
  const complete = () => {
    if (token !== generation) return;
    clearTimeout(timer);
    timer = undefined;
    speaking = false;
    audio = null;
    current = null;
    lastEndedAt = Date.now();
    /* The winner waited for the run-home call to finish its sentence. */
    const waiting = afterCurrent;
    afterCurrent = null;
    if (waiting && enabled) {
      speak(waiting.text, 'finish', waiting.cue);
      return;
    }
    /* The queued line is said only while its caption is still fresh. */
    const next = pending;
    pending = null;
    if (next && Date.now() - next.at <= QUEUE_MAX_WAIT_MS) {
      current = { priority: next.priority, rank: next.rank, startedAt: Date.now() };
      timer = setTimeout(() => {
        timer = undefined;
        current = null;
        if (token === generation && enabled) speak(next.text, next.priority, next.cue, next.opts);
      }, QUEUE_GAP_MS);
    }
  };
  try {
    initVoice();
    if (preferredVoiceURI === 'recorded' || !voice) {
      const id = cue ?? recordedCueFor(text);
      if (!id) { speaking = false; current = null; return false; }
      const now = Date.now();
      const finish = priority === 'finish';
      /* A different take of the same cue may follow after a few seconds; a
         twist always gets its line if any take is free. */
      if (!finish && !opts.twist && now - (lastCueAt.get(id) ?? -Infinity) < SAME_CUE_GAP_MS) {
        speaking = false; current = null; return false;
      }
      const take = finish ? pickTake(id, Math.random, opts.takes, -Infinity) || 1 : pickTake(id, Math.random, opts.takes, now);
      if (!take) { speaking = false; current = null; return false; }
      lastCueAt.set(id, now);
      lastTakeAt.set(`${id}#${take}`, now);
      const clip = new Audio(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/audio/commentary/${clipFile(id, take)}`);
      audio = clip;
      clip.volume = getLevels().master;
      clip.onended = complete;
      clip.onerror = complete;
      /* Duck the music for as long as the clip actually runs. The length is
         only known once the metadata arrives, so start with a short duck and
         extend it to the real duration when the clip reports one. */
      duck(CLIP_DUCK_FALLBACK_S, VOICE_DUCK, 'voice', { attack: VOICE_DUCK_ATTACK, release: VOICE_DUCK_RELEASE });
      clip.onloadedmetadata = () => {
        if (token !== generation) return;
        const seconds = clip.duration;
        /* Same owner: this replaces the fallback, shorter or longer. */
        if (Number.isFinite(seconds) && seconds > 0) {
          duck(seconds + 0.1, VOICE_DUCK, 'voice', { attack: VOICE_DUCK_ATTACK, release: VOICE_DUCK_RELEASE });
        }
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
      duck(Math.max(3, text.split(/\s+/).length / 2.5), VOICE_DUCK, 'voice', { attack: VOICE_DUCK_ATTACK, release: VOICE_DUCK_RELEASE });
      synth()?.speak(utterance);
    }
    // A broken browser callback must not strand the caller indefinitely.
    timer = setTimeout(() => {
      if (token !== generation) return;
      fadeOutClip(audio);
      try { synth()?.cancel(); } catch { /* Continue without audio. */ }
      complete();
    }, 15000);
    return true;
  } catch { complete(); return false; }
}

/** Fade the line on air and say this one once it is gone. */
function cutIn(text: string, priority: CallPriority, cue?: RecordedCue, opts: SayOptions = {}): void {
  stopCurrent();
  const token = generation;
  current = { priority, rank: rankOf(priority, opts), startedAt: Date.now() };
  timer = setTimeout(() => {
    timer = undefined;
    current = null;
    if (token === generation && enabled) speak(text, priority, cue, opts);
  }, CLIP_FADE_MS);
}

/**
 * One line on air and at most one fresh line queued, never a speech
 * backlog. The finish is never cut off and never cuts anyone off mid-word:
 * it waits for a big call that is nearly done, or fades the line on air
 * over 300 ms and then speaks.
 *
 * Everything else is ranked. A twist's line cuts whatever minor or ordinary
 * line is on air (its card is already up); a lead change or any other
 * pre-empting call cuts a minor line. A line that cannot cut in is queued
 * only if nothing more important is already waiting, and the queue is one
 * line deep: a lesser call landing on a queued bigger one is dropped, a
 * bigger one replaces it. A queued line is said only while its caption is
 * still fresh, `QUEUE_MAX_WAIT_MS`.
 */
export function say(text: string, priority: CallPriority = 'call', cue?: RecordedCue, opts: SayOptions = {}): boolean {
  if (!enabled || !voiceAvailable() || !text.trim()) return false;
  if (priority === 'finish') {
    pending = null;
    afterCurrent = null;
    if (speaking && current && current.priority === 'big' && voiceBusyMs() <= FINISH_WAIT_MS) {
      afterCurrent = { text, cue };
      return true;
    }
    if (speaking || timer) {
      cutIn(text, 'finish', cue);
      return true;
    }
    return speak(text, priority, cue);
  }
  if (afterCurrent) return false;
  const rank = rankOf(priority, opts);
  if (current) {
    /* The race is over once the winner is being called: nothing else is said. */
    if (current.priority === 'finish') return false;
    const canCut = priority === 'big' && Boolean(opts.preempt) && (Boolean(opts.twist) || current.rank >= MINOR_RANK);
    if (canCut) {
      cutIn(text, priority, cue, opts);
      return true;
    }
    if (priority === 'big' && (!pending || rank <= pending.rank)) {
      pending = { text, priority, cue, at: Date.now(), opts, rank };
    }
    return false;
  }
  if (priority === 'call' && Date.now() - lastEndedAt < 1500) return false;
  return speak(text, priority, cue, opts);
}

export function previewVoice(): boolean {
  silence();
  return speak('The field is ready. Let us get this race started.', 'big', 'ready');
}
