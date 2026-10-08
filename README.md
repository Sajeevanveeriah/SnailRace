# NDCC Snail Race

An 8-to-20-runner, club-branded snail-race fundraiser for Newcomb & District
Cricket Club. It combines a projector telecast, free fun-chip picks, optional
Phone Play, separate Stripe or cash donations, audit and replay tools, and a
one-volunteer run of show.

This repository implements an original NDCC production. It uses its own club
crest, runner art, copy, commentary and cricket-ground surprises.

## Current release - the card night (5.0)

The night is a **card of one hundred snails**: ten races of ten. A supporter
buys a numbered snail for $4, names it, and that number fixes its race (1 to
10 in race 1, 11 to 20 in race 2, and so on). The projector shows five screens
and nothing else; the desk has three panels; the phone does one thing.

What changed from 4.2, point by point from the room's feedback:

1. **Simpler.** Projector screens: Welcome, Racecard, Race, Result, Quaddie
   (only while one runs), Thank you. The market, championship and intermission
   screens, the ticker, timing splits, start-list slate, on-air bug, goal ring,
   confetti, pit board and standings are gone. The desk is run of show, roster
   and audio/camera; everything else is behind **Admin**.
2. **No slithering.** The synthesised crowd bed and the noise-based crowd
   reactions are removed outright. Audio is one choice: **Music**,
   **Commentary** or **Off** (`A` cycles, `S` silences). Supplied
   `crowd-cheer.mp3`/`crowd-gasp.mp3` files still play if a club drops them in.
3. **Snails 1 to 100, ten a race.** `lib/card.ts` holds the card. Race N's
   field is always its ten numbers; an unsold snail still runs as "Snail N".
4. **Owners name their snails.** The roster (desk for the next race, Admin for
   all 100) edits name and owner per number, imports a pasted list, and copies
   a CSV. A paid Stripe snail names itself. Names for a race lock when it is
   armed and are recorded with the result.
5. **Telecast camera.** The default shot follows the leading pack (leader to
   fourth) and names who is behind the shot in a strip under the picture;
   the finish is always the locked full straight. The on-screen button and the
   desk flip to the full course at any time.
6. **A deck of surprises.** On top of both existing books, `DECK_CARDS` in
   `lib/race-engine.ts` deals field-wide and late cards that reach the finish
   straight: Plague at the Line, Magpie at the Post, The Big Freeze, Headwind,
   Reverse Gear, Lucky Last, Groundskeeper Shuffle, Late Shell Swap,
   Sprinklers in the Straight. Once-a-night cards are dealt without
   replacement across the ten races (`dealtCards`), so the plague at the line
   is the moment of the night, not of every race. Every card is a bounded,
   persistent clock consequence inside the same per-lane cap, drawn and
   hashed before countdown. Intensity: Calm deals none, Standard up to one,
   Big night one or two, Chaos (the default) two or three, scaled to race length.
7. **Fewer graphics.** See 1.
8. **Quaddie.** Four nominated races (default 3, 5, 7, 9), $10 a ticket,
   every four-leg winner shares the pool after the club's share, dividends
   rounded down to 10c, an unwon pool stays with the club and the screen says
   so. The board shows who is still alive after each leg. Like the cash tote
   it is **permit-gated**: off until the operator records the club's authority
   reference and attests to it in Admin. `lib/quaddie.ts` imports nothing from
   the race engine.
9. **$4 and a QR.** One Stripe Payment Link sells a snail at the card price
   and asks for the number, the snail's name and the owner's name on Stripe's
   own page. With a Stripe key on the server the link is minted automatically
   and paid snails fill the roster from the Checkout Session's custom fields.
   On the static GitHub Pages build, create the link in the Stripe dashboard,
   paste it into Admin, and fill the roster from the Stripe export with
   **Paste list**.

The live engine is still `consequential-eight-v1`: one seed draws the complete
immutable plan before countdown, the stage records a configuration commitment
and a plan hash, the first crossing freezes the field, and replays and audits
are unchanged.

## Money

A $4 snail is a purchase of a named entry on the card. The app records it, puts
the name on the board and never pays it out. Stripe donations through the older
`/donate` route remain gifts with no return. The quaddie and the cash tote are
the only products that pay money out, and both sit behind the operator's permit
attestation. The app does not claim legal clearance for any of it; the club
obtains the advice it needs for its own event.

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
| `/` | Projector and operator | Run of show, race stage, roster, quaddie and Admin |
| `/play` | Audience phone | Legacy Phone Play room (off the projector in 5.0; kept for clubs that still use it) |
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
2. In Admin, set the snail price, paste the Stripe Payment Link (static build)
   or confirm it was minted (server build), and enable the quaddie if the club
   holds the authority for it.
3. Welcome screen up. People scan, pay $4, name their snail. Paid snails
   appear on the roster; cash sales are typed at the desk.
4. Racecard for race 1: read the ten snails and owners. **To the gate**, then
   **Start race**. The plan is drawn and hashed, then the countdown runs.
5. Let the finish play out. The result card names the winner, number and
   owner. **Next** goes to the quaddie board (if live) or the next racecard.
6. Audio and camera are on the desk: Music / Commentary / Off, Telecast /
   Full course. The Holding screen checkbox parks the projector between races.
7. After race ten, the thank-you screen lists every winner. Export the audit
   and a backup from Admin, and reconcile Stripe separately.

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
