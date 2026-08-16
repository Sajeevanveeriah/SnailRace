'use client';

import { duck } from './music';

/**
 * The race caller.
 *
 * The stage has always written commentary; this says it out loud, which is
 * what a room actually means by "commentary". It uses the browser's own
 * speech synthesis, so it stays in keeping with the rest of the audio: no
 * files, no licence, no network, and it works on the venue laptop that has
 * never heard of this app.
 *
 * The hard part is not speaking, it is NOT speaking. A race throws lines
 * faster than anyone can say them - a surprise, a lead change and a lap call
 * can land within a second of each other - and a naive queue would still be
 * describing the first lap as the winner crosses the line. So every line
 * carries a priority:
 *
 *   - `big`  the moments the room came for. Interrupts whatever is being
 *            said, because a lead change matters more than the end of the
 *            sentence it lands in.
 *   - `call` the ordinary run of play. Spoken only if the caller is free;
 *            dropped otherwise, exactly as a human commentator drops a line
 *            they no longer have time for.
 *
 * Nothing here is on the critical path: if the browser has no voices, or
 * speech throws, the night carries on with the written commentary alone.
 */

export type CallPriority = 'big' | 'call';

let enabled = false;
let voice: SpeechSynthesisVoice | null = null;
let picked = false;
/** Cleared by the utterance's own end/error handlers. */
let speaking = false;
let lastSpokenAt = 0;

/** Minimum gap between ordinary calls, so the caller is not relentless. */
const CALL_GAP_MS = 2600;

const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

export const voiceAvailable = (): boolean => synth() !== null;

/**
 * Choose a voice once.
 *
 * `getVoices` is asynchronous on most browsers and returns an empty list on
 * the first call, so this is retried on the `voiceschanged` event. An English
 * voice is preferred and an Australian one preferred above that, this being a
 * cricket club; failing both, the browser default is perfectly serviceable.
 */
function pickVoice(): void {
  const s = synth();
  if (!s || picked) return;
  const all = s.getVoices();
  if (!all.length) return;

  const score = (v: SpeechSynthesisVoice): number => {
    const lang = v.lang?.toLowerCase() ?? '';
    if (lang.startsWith('en-au')) return 4;
    if (lang.startsWith('en-gb')) return 3;
    if (lang.startsWith('en')) return 2;
    return 1;
  };
  voice = all.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
  picked = true;
}

export function initVoice(): void {
  const s = synth();
  if (!s) return;
  pickVoice();
  if (!picked) s.addEventListener('voiceschanged', pickVoice, { once: true });
}

export function setVoiceEnabled(on: boolean): void {
  enabled = on;
  if (!on) silence();
  else initVoice();
}

export const isVoiceEnabled = (): boolean => enabled;

/** Stop mid-sentence. Used on reset, and when the caller is switched off. */
export function silence(): void {
  speaking = false;
  try {
    synth()?.cancel();
  } catch {
    /* Some browsers throw if cancel lands between utterances. Harmless. */
  }
}

/**
 * Say a line, or decide not to.
 *
 * Returns whether it was spoken, which is only used by the tests - callers
 * treat commentary as fire-and-forget.
 */
export function say(text: string, priority: CallPriority = 'call'): boolean {
  const s = synth();
  if (!enabled || !s || !text) return false;

  const now = Date.now();
  if (priority === 'call') {
    /* Ordinary lines wait their turn and are dropped rather than queued. */
    if (speaking || now - lastSpokenAt < CALL_GAP_MS) return false;
  } else {
    silence(); // a big moment talks over whatever was being said
  }

  try {
    const u = new SpeechSynthesisUtterance(strip(text));
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-AU';
    /* A shade quick and a shade high: a race caller, not a newsreader. */
    u.rate = priority === 'big' ? 1.22 : 1.1;
    u.pitch = priority === 'big' ? 1.15 : 1.02;
    u.volume = 1;

    speaking = true;
    lastSpokenAt = now;
    u.onend = () => {
      speaking = false;
    };
    u.onerror = () => {
      speaking = false;
    };

    /* Pull the music down so the caller is intelligible over it. */
    duck(priority === 'big' ? 2.2 : 1.6, 0.35);
    s.speak(u);
    return true;
  } catch {
    speaking = false;
    return false;
  }
}

/**
 * Written commentary is punctuated for the eye. A caller reads it aloud, and
 * a hyphen used as an aside becomes an audible stumble, so the dashes go and
 * the shouted words are left to the rate and pitch instead of the capitals.
 */
function strip(text: string): string {
  return text
    .replace(/\s+-\s+/g, ', ')
    .replace(/\{[ab n]\}/g, '')
    .trim();
}
