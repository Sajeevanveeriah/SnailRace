# NDCC Snail Race

An 8-to-20-runner, club-branded snail-race fundraiser for Newcomb & District
Cricket Club. It combines a projector telecast, free fun-chip picks, optional
Phone Play, separate Stripe or cash donations, audit and replay tools, and a
one-volunteer run of show.

This repository implements an original NDCC production. It uses its own club
crest, runner art, copy, commentary and cricket-ground surprises.

## Current release - consequential live-field races

The current live engine is `consequential-eight-v1`:

- Every live race supports a configurable field of 8 to 20 runners.
- Before countdown, one seed draws the complete immutable race plan: runner
  motion, all surprise targets and timings, warning/reveal/effect/commentary
  cues, persistent clock consequences, any rare safe retirement, the winner,
  and the complete classification.
- The stage records both a configuration commitment and a plan hash before the
  gates open. Runtime animation only instantiates that plan; it does not make
  new competitive decisions.
- Surprises are consequential. A boost, delay or safe retirement can change the
  result, but that consequence is already part of the locked plan. Donations,
  fun-chip picks and audience reactions are not inputs to the engine.
- The instant the first active runner crosses, the animation freezes on that
  authoritative frame. The winner is shown immediately, then the result card
  opens after a confirmation beat capped at 450 ms. The show never waits for
  the remaining runners to crawl home.
- Active trailing runners are classified by their progress at the stop frame.
  A safely retired runner is marked `RET`, carries a reason, and ranks after
  active runners.
- The stored plan, cues and stop-frame classification drive archive replay, so
  a replay tells the same consequential story rather than reconstructing the
  older decorative-surprise model.

Legacy all-finisher records remain readable. New live races use the locked
8-to-20-runner path.

## The October 2026 night

A fresh night opens pre-configured from the club's poster: **Snail Racing - A
night at the races**, Saturday 24 October 2026 from 7 pm at the club rooms,
$10 per snail. The welcome screen shows the poster, the date line and "Back
your snail. Cheer it home."; the ticker carries the same facts; the page
metadata and share image match. Backing a snail is a suggested gift to the
club that puts a name on the board, never a stake. Every one of these fields
(tagline, date, start time, venue, suggested gift) is editable in the console
and a saved night keeps its own values.

## What changed in 4.2

- **Live TV presentation.** A start-list slate before the off, timing splits at
  the quarter, half and lap marks, a scrolling ticker built from recorded facts
  (sponsors, raised total, championship, tote pool, join code), an on-air bug
  with the clock and conditions, a photo-finish badge and an official-result
  lower third over the frozen finish frame. Reduced motion shows the same
  furniture without sliding or scrolling.
- **Permit-gated cash tote and last-race runner auction.** Off by default and
  structurally separate from fun chips and donations. See below.
- **Second surprise book.** Twelve new individual set pieces, five new field
  incidents and three new family-safe retirements, drawn as vector props so
  nothing depends on the projector laptop's emoji font.
- **Audio.** Overlapping ducks no longer ratchet the music down to silence,
  the recorded caller no longer plays "And they are away!" in the middle of a
  race, and the run-of-play lines now map to truthful generic clips so the
  natural caller talks between set pieces. Two new event sounds (rain, crowd
  wave).
- **Fixes.** The fun-chip board on the market screen is readable on a laptop
  running a light colour scheme, and the result card no longer uses betting
  language or points at a QR code that is not on screen.

## Money and free chips are structurally separate

Stripe and cash entries are donations to the club with no return. Fun chips are
free play counters with no monetary value, no purchase path and no cash-out.

Every runner carries the same fixed fair play price: `N.00 for 1` in an
N-runner race, including the returned stake. The room's pick bars show only
free chips. A donation amount, supported lane or change in total raised cannot
alter the displayed price or a chip return; donation data is not passed to the
fun-chip maths.

The app does not provide real-money wagering or claim legal clearance. The club
must obtain any event-specific regulatory advice it needs.

### The permit-gated cash tote

Some clubs hold their own authority to run a tote at a race night (in Victoria
typically a VGCCC minor gaming permit, or a confirmed exemption). For those
clubs the console offers a **cash tote** that is off by default and cannot be
switched on until the operator types the permit or authority reference and
ticks an attestation that the club holds it. The app records that attestation
in the audit trail; it does not decide the question and makes no legal claim.

Once live:

- paper tickets are sold and paid at the table; the volunteer tallies tickets
  per runner on the console or the moderator desk before the off;
- the projector's market screen shows the tote board (tickets per runner, pool,
  and what one ticket would pay if that runner won now), labelled as the club's
  cash tote and kept apart from the free-chip board;
- the dividend settles from the recorded result, is rounded down to ten cents,
  breakage stays with the club, and an unbacked winner leaves the pool with the
  club, stated on screen;
- the last race on the card can be sold by runner auction instead, highest
  standing bid owns the runner;
- every settlement is written to the audit trail, the printed report carries a
  payout sheet, and a tote CSV export exists for reconciliation.

`lib/cash-tote.ts` imports nothing from the race engine, the fun-chip maths,
the settlement path or the donation ledger, and none of them import it. A unit
test enforces that boundary, and a backup that claims `enabled` without the
attestation loads with the tote off.

## Projector experience

The stage is built as an NDCC cricket-night broadcast:

- the supplied transparent club crest and its maroon, gold and blue palette;
- eight approved runner silhouettes, with distinct colourways for larger fields, and a full-field timing tower;
- a side-on moving telecast, circuit or straight-lane presentation, race clock,
  lap/sector calls, commentary strap and optional spoken caller;
- deterministic weather, photo-finish treatment and authored surprise theatre;
- four-beat consequential moments - warning, reveal, effect and commentary -
  including field-wide incidents and rare family-safe retirement set-pieces;
- full-bleed show screens for lobby, racecard, market, race, result,
  championship, intermission and finale;
- broadcast furniture: a start-list slate with tonight's form and runner
  sponsors, timing splits, a ticker of recorded facts, an on-air bug with the
  clock and conditions, a photo-finish badge and an official-result lower third;
- reduced-motion support, keyboard operation and an operator preflight panel.

The crest is committed at
`public/brand/20260403-NDCC-Logo-Bg-Removed-Rev00.png`; runtime presentation art
is served from `public/art/` and does not need venue Wi-Fi.

### Surprise catalogue

The committed event book currently contains:

| Group | Authored moments |
| --- | --- |
| Advances | Turbo Slime, Second Wind, Slipstream, Downhill Run, Triple Espresso, Crowd Lift, Fresh Wax, Sightscreen Shortcut, Drinks Break Energy, Tailwind, Home Crowd Roar |
| Delays | Shell Slip, Micro-Nap, Lettuce Break, Gravel Patch, Cramp, Wrong Way, Snail Mail, Stage Fright, Bogged, Tea Interval, Selfie Stop, Dew on the Outfield, Sunscreen Stop, Covers Crew |
| Wild effects | Mystery Slime, Banana Peel, Snail Romance, Third Umpire, Sledged from Slips, Shell Swap, DRS Review, Mystery Spinner, Sightscreen Glare |
| Field incidents | The Plague, Magpie Swoop, Sprinklers On, Rogue Cricket Ball, Dog on the Track, Lettuce on the Track, False Start Panic, Pitch Roller Crossing, Rain Squall, Mexican Wave, Seagull Raid, Ice Cream Van, Pitch Invader |
| Rare safe retirements | Groundskeeper Boot Scare, Boundary Bee Scare, Roller Obstruction, Loose Cricket Ball, Sprinkler Stop, Seagull Scare, Covers Call, Drinks Cart Crossing |

Painted set pieces use the committed PNG props; everything else is drawn as a
vector prop in `components/race-broadcast/prop-glyphs.tsx`, so the course never
depends on the projector laptop's emoji font.

Intensity controls how much of the ordinary event book is dealt. A retirement
is instead a separate race-level rarity, is never multiplied by intensity and
can affect no more than one runner. Every dealt item and every audience cue is
inside the pre-countdown plan hash.

## Routes

| Route | Audience | Purpose |
| --- | --- | --- |
| `/` | Projector and operator | Complete run of show, race stage, free-chip board, fundraising total and moderator controls |
| `/play` | Audience phone | Join a room, make free-chip picks, react and view the chip leaderboard |
| `/donate` | Supporter phone | Make a separate club donation through Stripe Checkout when the Next server API is available |
| `/donate/thanks` | Donor | Confirm the Stripe donation returned by the server |
| `/archive` | Operator or audience | Review stored results, audit metadata and deterministic replays |

## Live lock, acknowledgement and recovery

Phone Play is authoritative for remote chip balances and uses an explicit race
lifecycle. The stage first obtains a `LOCKED` acknowledgement for the exact race
number, attempt and plan hash, then obtains `RUNNING`, before it begins countdown.
Operator mutations carry stable command IDs and expected revisions so a retry
can return the original receipt instead of applying twice.

If an acknowledgement is ambiguous, the stage enters `HELD`: selections remain
closed and the already-drawn plan remains in place. **Retry lock** reuses that
same plan and command identity. It does not silently re-roll the race.

A moderator void before the first finisher produces no result and no settlement.
Remote picks are refunded atomically, and the same race opens again only after
both void and rearm are acknowledged. If safe rearm cannot be confirmed, the
market stays closed for operator recovery.

## Deployment shapes

| Shape | Projector and local free chips | Phone Play | Card donations | Durable live state |
| --- | --- | --- | --- | --- |
| Next server (`next start`) | Yes | Co-located `/api/live/*` service | Yes, with Stripe keys | File-backed single-server store under `SNAILRACE_DATA_DIR` |
| GitHub Pages only | Yes | Unavailable; the client makes no live API calls | No; cash recording remains local | Browser event state only |
| GitHub Pages + Cloudflare Worker | Yes | Yes, through `NEXT_PUBLIC_LIVE_API_ORIGIN` | No; the Worker never handles donations | One SQLite-backed Durable Object per room |

The Pages workflow removes `app/api` before static export, applies the repository
base path, and optionally injects the exact HTTPS Cloudflare Worker origin. The
Worker mirrors the live route contract, enforces an exact CORS allowlist and keeps
operator capabilities out of URLs. See [the Cloudflare hand-off](cloudflare/README.md).

Cloudflare account changes and deployment are intentionally operator actions;
the repository contains the Worker source and configuration but does not imply
that a Worker has been deployed.

## Operator quick runbook

1. Choose the deployment shape and run preflight before doors open.
2. Confirm the event details and all eight runner names; open Phone Play only
   after the real phone can join the room.
3. On the market screen, remind the room that every lane is fixed at 8.00 and
   free chips never meet donations. If the club runs its own permitted cash
   tote, tally the paper tickets per runner before the off.
4. Start the race. The app draws and hashes the complete plan, closes picks,
   obtains any required remote lock/run acknowledgements, then counts down.
5. Call the locked surprises as they land. At the first crossing, stop: the
   result is already complete and appears immediately without waiting for the
   trailing field.
6. If the stage says `HELD`, keep the market closed and retry the same lock. If
   a race must be abandoned before the finish, use the audited void path and
   wait for rearm acknowledgement before reopening picks.
7. After the night, export donations and audit records, save a backup, archive
   the event, and reconcile Stripe donations against Stripe separately from
   every chip report.

The detailed volunteer script is
[docs/20260830-Operator-Runbook-Rev01.md](docs/20260830-Operator-Runbook-Rev01.md).

## Development and checks

```bash
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

These are the release commands, not a claim that a particular checkout or
deployment has passed them. Run the full set, including browser tests at the
actual projector and phone sizes, before promoting a build for a club night.

Useful environment variables:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Next server | Create and read donation-only Stripe Checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | Next server | Verify Stripe webhooks and refresh donation data promptly |
| `NEXT_PUBLIC_SITE_URL` | Next server | Build absolute Stripe return URLs when the request has no usable origin |
| `SNAILRACE_DATA_DIR` | Next live service | Choose the file-backed Phone Play data directory |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Browser tests | Point Playwright at a preinstalled Chromium when it cannot download its own |
| `NEXT_PUBLIC_LIVE_API_ORIGIN` | Static Pages build | Route Phone Play to the approved Cloudflare Worker origin |
| `ALLOWED_ORIGINS` | Cloudflare Worker | Exact comma-separated browser origins allowed to use the live service |

The Cloudflare dependency-free contract probe can also be run with Node 24:

```bash
node --experimental-strip-types cloudflare/test/contract-probe.ts
```

## Architecture notes

- Next.js App Router, React and strict TypeScript provide the stage and the
  co-located API shape.
- `lib/race-engine.ts` owns both the historical all-finisher path and the
  current locked consequential engine. `lib/audit.ts` versions configuration,
  plan and result hashes.
- `lib/tote.ts` receives bets, names and a race number - never donations - and
  assigns the same fixed price to all eight equal-chance runners.
- `lib/live/store.ts` is the single-Node fallback; `cloudflare/src/index.ts`
  provides the Durable Object deployment option for static Pages.
- Stripe remains the card-donation ledger. Local event history, cash entries,
  backups and archived nights remain on the operator device.
- All operator and audience flows are designed to fail closed: an unknown
  lock, settlement or rearm state does not reopen selections or invent a new
  result.

Historical acceptance, readiness, threat-model and broadcast-release files in
`docs/` are retained as snapshots of earlier builds. Their superseded banners
identify them; their old test counts and behaviour claims are not evidence for
this release.
