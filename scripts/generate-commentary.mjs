#!/usr/bin/env node
/**
 * Record the race-call script in `lib/audio/voice-cues.ts` as MP3 clips.
 *
 * NOT A BUILD STEP. This needs a running Resemble AI Chatterbox endpoint (the
 * Hugging Face space `ResembleAI/Chatterbox`, or your own), a public URL for
 * the reference-voice clip, and a GPU quota that the public space hands out
 * in small daily amounts. It cannot run unattended in CI and is not wired
 * into `npm run build`. Run it by hand, check `RECORDED_TAKES`, commit the
 * clips.
 *
 *   node --experimental-strip-types scripts/generate-commentary.mjs             # every missing take
 *   node --experimental-strip-types scripts/generate-commentary.mjs lead winner # only these cues
 *   node --experimental-strip-types scripts/generate-commentary.mjs --force photo
 *   node --experimental-strip-types scripts/generate-commentary.mjs --dry-run   # list what is missing
 *   node --experimental-strip-types scripts/generate-commentary.mjs --local     # same model, on this machine
 *
 * --local runs scripts/chatterbox-local.py with CHATTERBOX_PYTHON (default
 * `python3`), which needs `pip install chatterbox-tts` (CPU PyTorch is enough,
 * about 15 s a take; install `setuptools<81` too for its watermarker). It uses
 * public/audio/voice-reference.mp3 as the voice and no quota applies.
 *
 * Environment:
 *   CHATTERBOX_URL   Gradio base URL. Default https://resembleai-chatterbox.hf.space
 *   HF_TOKEN         Optional Hugging Face token (raises the ZeroGPU quota).
 *   VOICE_PROMPT_URL Public URL of the reference voice. Default: the deployed
 *                    `audio/voice-reference.mp3`, the previous caller's clip
 *                    kept aside so every run clones the same voice (the cue
 *                    clips themselves are generated and must not be cloned).
 *   FFMPEG           ffmpeg binary with libmp3lame. Default: `ffmpeg` on PATH.
 *
 * What it does, per take:
 *   1. POST /gradio_api/call/generate_tts_audio with the line, an
 *      "exaggeration" from CUE_ENERGY (0.7 early race, 0.9 twists, 1.1 at the
 *      finish), cfg 0.35, temperature 0.8 and a fixed seed per take.
 *   2. Stream the result, download the 24 kHz mono WAV.
 *   3. Trim leading/trailing silence and encode mono 24 kHz 64 kbps MP3 as
 *      public/audio/commentary/<cue>.mp3, <cue>-2.mp3, <cue>-3.mp3 and on,
 *      one file per line written for the cue.
 *   4. Rewrite the RECORDED_TAKES block in voice-cues.ts.
 *
 * Each line is generated once. On more than five consecutive failures
 * (usually "ZeroGPU quota exceeded") it stops and keeps what it has; run it
 * again later and it continues from the first missing take.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CUES_TS = join(ROOT, 'lib', 'audio', 'voice-cues.ts');
const OUT_DIR = join(ROOT, 'public', 'audio', 'commentary');
const BASE = (process.env.CHATTERBOX_URL ?? 'https://resembleai-chatterbox.hf.space').replace(/\/$/, '');
const PROMPT = process.env.VOICE_PROMPT_URL ?? 'https://sajeevanveeriah.github.io/SnailRace/audio/voice-reference.mp3';
const LOCAL_PROMPT = join(ROOT, 'public', 'audio', 'voice-reference.mp3');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const MAX_CONSECUTIVE_FAILURES = 5;

const { RECORDED_CUES, RECORDED_TAKES, CUE_ENERGY, clipFile } = await import('../lib/audio/voice-cues.ts');

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const local = args.includes('--local');
const only = new Set(args.filter((a) => !a.startsWith('--')));
const allCues = Object.keys(RECORDED_CUES);
const cues = allCues.filter((cue) => !only.size || only.has(cue));
/* A take's seed depends on its cue's place in the whole script, never on which cues were asked for. */
const seedFor = (cue, take) => 1000 + allCues.indexOf(cue) * 10 + take;
const recorded = { ...RECORDED_TAKES };
const tmp = mkdtempSync(join(tmpdir(), 'commentary-'));
const headers = { 'content-type': 'application/json', ...(process.env.HF_TOKEN ? { authorization: `Bearer ${process.env.HF_TOKEN}` } : {}) };

/** Call the Gradio endpoint and return the WAV URL. */
async function synthesise(text, exaggeration, seed) {
  const submit = await fetch(`${BASE}/gradio_api/call/generate_tts_audio`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: [text, { path: PROMPT, url: PROMPT, meta: { _type: 'gradio.FileData' } }, exaggeration, 0.8, seed, 0.35, true],
    }),
  });
  if (!submit.ok) throw new Error(`submit ${submit.status}: ${await submit.text()}`);
  const { event_id: id } = await submit.json();
  const stream = await fetch(`${BASE}/gradio_api/call/generate_tts_audio/${id}`, { headers });
  const body = await stream.text();
  const complete = body.split('\n').findIndex((line) => line === 'event: complete');
  if (complete < 0) throw new Error(`no result: ${body.slice(0, 300)}`);
  const data = JSON.parse(body.split('\n')[complete + 1].replace(/^data:\s*/, ''));
  const url = data?.[0]?.url;
  if (!url) throw new Error(`no audio url in ${JSON.stringify(data).slice(0, 300)}`);
  return url;
}

function encode(wavPath, mp3Path) {
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath,
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse',
    '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '64k', mp3Path,
  ]);
}

function writeTakes() {
  const src = readFileSync(CUES_TS, 'utf8');
  const start = src.indexOf('export const RECORDED_TAKES');
  const end = src.indexOf('};', start) + 2;
  if (start < 0 || end < 2) throw new Error(`RECORDED_TAKES block not found in ${CUES_TS}`);
  const body = Object.keys(RECORDED_CUES).map((cue) => `  ${cue}: ${recorded[cue] ?? 0},`).join('\n');
  /* The block keeps its `};` terminator so the next run can find it again. */
  writeFileSync(CUES_TS, `${src.slice(0, start)}export const RECORDED_TAKES: Record<RecordedCue, number> = {\n${body}\n};${src.slice(end)}`);
}

/* --local: record every missing take in one model load, then the loop below
   picks each WAV up instead of calling the space. */
if (local && !dryRun) {
  const jobs = [];
  for (const cue of cues) {
    for (let take = (force ? 0 : recorded[cue] ?? 0) + 1; take <= RECORDED_CUES[cue].length; take++) {
      jobs.push({ cue, take, file: clipFile(cue, take), text: RECORDED_CUES[cue][take - 1], exaggeration: CUE_ENERGY[cue], seed: seedFor(cue, take) });
    }
  }
  writeFileSync(join(tmp, 'jobs.json'), JSON.stringify(jobs));
  execFileSync(process.env.CHATTERBOX_PYTHON ?? 'python3', [join(ROOT, 'scripts', 'chatterbox-local.py'), join(tmp, 'jobs.json'), LOCAL_PROMPT, tmp], { stdio: 'inherit' });
}

let failures = 0;
let made = 0;
outer: for (const cue of cues) {
  const from = force ? 0 : recorded[cue] ?? 0;
  for (let take = from + 1; take <= RECORDED_CUES[cue].length; take++) {
    const text = RECORDED_CUES[cue][take - 1];
    const seed = seedFor(cue, take);
    process.stdout.write(`${clipFile(cue, take)}: "${text}" ... `);
    if (dryRun) { console.log('(dry run)'); continue; }
    try {
      const wav = join(tmp, `${cue}-${take}.wav`);
      if (local) {
        if (!existsSync(wav)) throw new Error('not recorded by chatterbox-local.py');
      } else {
        const url = await synthesise(text, CUE_ENERGY[cue], seed);
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`download ${res.status}`);
        writeFileSync(wav, Buffer.from(await res.arrayBuffer()));
      }
      encode(wav, join(OUT_DIR, clipFile(cue, take)));
      recorded[cue] = take;
      made++;
      failures = 0;
      console.log('ok');
    } catch (error) {
      failures++;
      console.log(`FAILED (${error.message.split('\n')[0]})`);
      if (failures > MAX_CONSECUTIVE_FAILURES) {
        console.error(`Stopping after ${failures} consecutive failures. Run again later to continue.`);
        break outer;
      }
      /* The recorded count is contiguous from take 1: a later take must not
         be claimed over a missing earlier one, so this cue ends here. */
      break;
    }
  }
}

if (!dryRun) writeTakes();
console.log(dryRun ? `dry run: nothing recorded.` : `${made} clip(s) recorded. RECORDED_TAKES updated in lib/audio/voice-cues.ts.`);
