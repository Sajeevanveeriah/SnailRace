/**
 * Write `public/audio/manifest.json` from whatever is actually in that folder.
 *
 * The audio engine needs to know which optional drop-in files exist before it
 * fetches any of them. Probing for each one instead costs two dozen 404s in
 * the console on every load, and a console full of red on a club's projector
 * laptop reads as a broken build to whoever opens dev tools on the night.
 *
 * Runs from `prebuild` and `predev`, so the loop for a club is unchanged: drop
 * files in, rebuild.
 */
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'public', 'audio');
const AUDIO = /\.(mp3|ogg|wav)$/i;

const files = await readdir(DIR)
  .then((all) => all.filter((f) => AUDIO.test(f)).sort())
  .catch(() => []); // No folder is a normal state: everything is synthesised.

await writeFile(
  join(DIR, 'manifest.json'),
  `${JSON.stringify({ files }, null, 2)}\n`,
).catch(() => {
  /* A read-only checkout still builds; the engine treats a missing manifest
     as "no drop-in audio" and synthesises everything. */
});

console.log(
  files.length
    ? `audio: ${files.length} drop-in file(s) - ${files.join(', ')}`
    : 'audio: none supplied, everything synthesised',
);
