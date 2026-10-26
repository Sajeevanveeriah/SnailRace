#!/usr/bin/env node
/*
 * Choose the club a build is for, or start a new one.
 *
 *   node scripts/club.mjs use [id]   write clubs/active.ts and copy the club's
 *                                    assets to public/club/ (id defaults to
 *                                    $CLUB, then ndcc)
 *   node scripts/club.mjs new <id> "Full club name" "SHORT"
 *                                    copy clubs/template to clubs/<id>
 *   node scripts/club.mjs list       the clubs in clubs/
 *
 * The npm dev, build, typecheck and test scripts run `use` first, so
 * `CLUB=<id> npm run build` is all a club build needs.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clubsDir = join(root, 'clubs');
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const clubs = () =>
  readdirSync(clubsDir).filter((d) => statSync(join(clubsDir, d)).isDirectory() && existsSync(join(clubsDir, d, 'club.ts')));

function fail(message) {
  console.error(`club: ${message}`);
  process.exit(1);
}

function select(id = process.env.CLUB || 'ndcc') {
  if (!ID.test(id)) fail(`"${id}" is not a club id (lower case letters, digits and hyphens).`);
  if (!clubs().includes(id)) fail(`no club "${id}". Clubs: ${clubs().join(', ')}.`);
  const active = join(clubsDir, 'active.ts');
  const body = `// Written by scripts/club.mjs; do not edit. Run \`npm run club -- use <id>\` to change club.\nexport { default } from './${id}/club';\n`;
  if (!existsSync(active) || readFileSync(active, 'utf8') !== body) writeFileSync(active, body);
  const out = join(root, 'public', 'club');
  rmSync(out, { recursive: true, force: true });
  const assets = join(clubsDir, id, 'assets');
  mkdirSync(out, { recursive: true });
  if (existsSync(assets)) cpSync(assets, out, { recursive: true });
  console.log(`club: ${id}`);
}

function create(id, name, shortName) {
  if (!id || !ID.test(id)) fail('usage: node scripts/club.mjs new <id> "Full club name" "SHORT"');
  const dest = join(clubsDir, id);
  if (existsSync(dest)) fail(`clubs/${id} already exists.`);
  cpSync(join(clubsDir, 'template'), dest, { recursive: true });
  const file = join(dest, 'club.ts');
  let src = readFileSync(file, 'utf8').replace("id: 'template'", `id: '${id}'`);
  if (name) src = src.replaceAll('Your Sports Club', name.replaceAll("'", "\\'"));
  if (shortName) src = src.replace("shortName: 'YSC'", `shortName: '${shortName.replaceAll("'", "\\'")}'`);
  writeFileSync(file, src);
  console.log(`club: made clubs/${id}. Edit clubs/${id}/club.ts, put the crest and logos in clubs/${id}/assets/, then CLUB=${id} npm run dev.`);
}

const [command = 'use', ...args] = process.argv.slice(2);
if (command === 'use') select(args[0]);
else if (command === 'new') create(...args);
else if (command === 'list') console.log(clubs().filter((c) => c !== 'template').join('\n'));
else fail(`unknown command "${command}". Use: use, new, list.`);
