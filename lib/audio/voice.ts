'use client';

import { duck } from './music';
import { getLevels } from './engine';
import { type RecordedCue, recordedCueFor } from './voice-cues';

export type CallPriority = 'big' | 'call' | 'finish';
export interface VoiceChoice { uri: string; name: string; lang: string; local: boolean }

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
let lastCue = '';
let lastCueAt = -Infinity;
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
  lastCue = '';
  lastCueAt = -Infinity;
  try { synth()?.cancel(); } catch { /* Cancellation is best effort. */ }
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
      if (id === lastCue && Date.now() - lastCueAt < 9000 && priority !== 'finish') { speaking = false; return false; }
      lastCue = id;
      lastCueAt = Date.now();
      const clip = new Audio(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/audio/commentary/${id}.mp3`);
      audio = clip;
      clip.volume = getLevels().master;
      clip.onended = complete;
      clip.onerror = complete;
      duck(6, 0.2);
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
