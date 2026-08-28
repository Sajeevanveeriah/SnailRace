# Snail Race Fundraiser - Acceptance Ledger

Date: 28 August 2026. Revision: Rev02 (Master Prompt 4). Every status is from fresh
evidence gathered this session against the v4 build: 71 unit checks, 48 API checks
(18 Stripe/security + 30 Phone Play abuse), 68 v3-preservation browser E2E checks,
52 v4 multi-context browser E2E checks, 8 static-export checks, both build shapes
clean, `tsc --noEmit` and ESLint at zero errors. Status values: PASS, BLOCKED
(external boundary, stated), DEVIATION (built differently, rationale given).

## A. Preservation of v3

| ID | Requirement | Status |
|----|-------------|--------|
| A1 | Every v3 acceptance PASS still passes on the v4 build | PASS. The full v3 E2E suite re-run against v4: 68/68, including race lifecycle, void, undo, settlement-once, replay scrubbing, media fingerprinting, Stripe failure states, 20-lane performance (34.7 fps vs the 26.8 baseline), calm/reduced-motion/no-voices. |
| A2 | v3 night data survives into v4 | PASS. Unit migration suite: a v3 backup restores with races, bets, chips and audit intact; every v4 field gains a deterministic default; the same backup always loads to the same night; `surprises:false` maps to the Calm preset; garbage refuses to restore instead of wiping the night (defect found and fixed this session). |

## B. Permanent invariants

| ID | Requirement | Status |
|----|-------------|--------|
| B1 | Fun chips have no monetary value; cannot be purchased, sold, converted or exchanged | PASS. Code audit: no path between cents and chips anywhere, including the new Phone Play store (`lib/live/store.ts` holds chips only; `lib/money.ts` cents only; no function crosses). Labels asserted on stage, show screens, phone join, phone leaderboard, console panels. |
| B2 | Donations never award chips or advantage | PASS. Donations enter `cashLedger`/Stripe feed only; `drawRace` and `drawPackRace` read neither. Unit: winner uniform across seeds; intensity presets change drama volume only. |
| B3 | No real-money wagering route exists | PASS. No payout code path; Stripe flows are donation-only with server-side amount bounds; phone picks accept chips only. |
| B4 | Victorian regulatory uncertainty fails closed; no legal-compliance claim from code | PASS. Runbook §6 and README state the boundary explicitly; nothing in-product claims compliance. |

## C. Research and originality

| ID | Requirement | Status |
|----|-------------|--------|
| C1 | Design-evidence matrix from named references | PASS. `docs/20260828-Design-Evidence-Matrix-Rev00.md`: reference → mechanic → why → original NDCC implementation; rejected money-mechanics noted. |
| C2 | No copied expression (Peedy, third-party voices, footage, layouts) | PASS. All presentation, host lines, racecard flavour and screens written original; recorded media restricted by per-race source and licence fields, validated at pack level. NDCC brand hex DEVIATION noted in the matrix (no authoritative values in repo; shipped palette kept). |

## D. Event model and modes

| ID | Requirement | Status |
|----|-------------|--------|
| D1 | First-class Event (Australia/Melbourne), date, venue, planned races | PASS. v4 `EventState`; console fields persist; E2E asserts defaults and edits. |
| D2 | Static demo mode: zero API calls, truthful about limits | PASS. Static suite 8/8: zero `/api` requests across stage, race, archive, replay and `/play`; `/play` says honestly it needs the event server. |
| D3 | Live animated event mode | PASS. v3 suite plus run-of-show E2E. |
| D4 | Recorded Race Pack mode | PASS. E2E: pack built from real video, per-file SHA-256, locked commitment in the audit (full hash), seeded audited draw, REC PLAYBACK chrome, sealed result revealed through the shared settlement path, media substitution refused by fingerprint, void-during-playback returns the race to the pool, stray clicker press starts nothing. |
| D5 | Rehearsal mode | PASS. E2E: REHEARSAL badge on projector and phones; clear-rehearsal removes races/chips/bets, keeps set-up and donations, audited. |
| D6 | Multi-night archive | PASS. Saved nights on-device with SHA-256 integrity; a fingerprint mismatch refuses to load. Unit + E2E. |

## E. Run of show and presentation

| ID | Requirement | Status |
|----|-------------|--------|
| E1 | Lobby → racecard → market → race → results → championship → intermission → finale, one-volunteer operable | PASS. E2E walks the entire night on Space alone; back steps back; intermission is a moderator choice; finale appears when the card completes. |
| E2 | Original host segments | PASS. `lib/show.ts` host lines per phase, incl. fun-chip rules; market countdown 30/10/5 calls. |
| E3 | Racecard separating fact from flavour, printable | PASS. FACT (points, places) vs CROWD (backing, odds) vs FLAVOUR (labelled "for fun"); print CSS; E2E asserts the label. |
| E4 | Broadcast presentation preserved; no decoration slop | PASS. Visual QA of 13 v4 screenshots plus the v3 set; show screens reuse the stage's established language (eyebrows, hairlines, tabular numerals). |
| E5 | Surprise director presets with zero-at-finish invariant | PASS. Unit: all four presets draw identical order and finish times from the same seed; standard is bit-identical to v3; envelope closes to zero (no early crossing) under every preset; budgets scale calm < standard < big ≤ chaos and stay capped. |

## F. Phone Play

| ID | Requirement | Status |
|----|-------------|--------|
| F1 | Server-authoritative cross-device play (code, QR, join, picks, lock, reconnect) | PASS. Multi-context E2E (projector + two phones): join by QR code, picks held server-side, market lock honoured, results and outcomes delivered, reload reconnects with the same identity, leaderboard on phone and console. |
| F2 | Phones never authoritative; operator key never leaves the stage | PASS. Unit + API: settlement and show pushes require the operator key (timing-safe compare); player payloads never contain it; wrong/truncated keys 403. |
| F3 | Idempotent, revisioned, abuse-resistant API | PASS. 30 API checks: nonce-idempotent picks (no double spend), pick replacement refunds first, bank limits, market/race staleness 409, origin 403, oversize body 413, array body 400, join flood 429 per address, reaction throttle, unknown/malformed codes, revisioned `unchanged` polling. |
| F4 | Settlement exactly once at locked odds | PASS. Unit + API: second settle answers `already`; winner paid `round(chips × odds)` once; E2E confirms cross-device. |
| F5 | Closing the room tells the phones | PASS. Operator close ends the server session (410); phones say the event ended (gap found by E2E this session and fixed with `/api/live/end`). |
| F6 | No paid cloud database | PASS. File-backed local store behind an interface (`SNAILRACE_DATA_DIR`), per-session write queues, atomic persists. |

## G. Reactions

| ID | Requirement | Status |
|----|-------------|--------|
| G1 | Reactions influence atmosphere only, rate-limited | PASS. Unit + API: throttled per phone (silently), capped ring buffer, no code path into any race or ledger; E2E: reaction floats over the projector; calm/reduced-motion suppress them. |

## H. Integrity and audit

| ID | Requirement | Status |
|----|-------------|--------|
| H1 | Tamper-evident audit hash chain, described accurately | PASS. `entryHash = SHA-256(prevHash + canonicalAuditEntry)`; unit: honest chains verify; edit, removal, reorder and forged-hash all break at the right entry; v3 entries anchor rather than fail. Console *Verify the hash chain* runs it live (E2E). |
| H2 | Recorded pack honesty about secrecy limits | PASS. The manifest-on-device limitation is stated on the pack panel and runner, and in the runbook - tamper evidence for the room, not secrecy from the laptop's owner. |
| H3 | Recovery scenarios | PASS. E2E: reload mid-race invents nothing; backup restore audited; corrupt backup refused; saved-night integrity check; phone reconnect; recorded void/re-draw. |
| H4 | Reports never combine chips with AUD | PASS. CSV/print inspection: donations CSV is AUD only; audit CSV carries hashes and text; chip figures appear only in chip-labelled panels. |

## I. Payments

| ID | Requirement | Status |
|----|-------------|--------|
| I1 | v3 Stripe integrity preserved | PASS. Full 18-check API suite re-run: webhook signature/replay/stale, origin, bounds, failure states, unconfigured 503s, security headers. |
| I2 | Provably no currency↔chips path | PASS. B1 evidence; grep audit of `cents`/`chips` call graphs recorded in the threat model. |
| I3 | Live refund round-trip | BLOCKED (unchanged from Rev01): needs real Stripe keys and a live transaction, which this engagement must not create. Refund netting logic remains unit-tested. |

## J. Release gates

| ID | Requirement | Status |
|----|-------------|--------|
| J1 | Zero failing tests, TS errors, ESLint errors; no weakened tests | PASS. 71 unit / 48 API / 128 browser checks green; `tsc --noEmit` clean; ESLint clean; v3 suites extended, never weakened (three v3 E2E helpers adapted only to walk the new run-of-show to the same assertions). |
| J2 | Both deployment shapes build | PASS. Server build and `GITHUB_PAGES=true` static export (with `app/api` removed, as the Pages workflow does) both compile clean. |

## Gap closures from Rev01

- **G1 (phones as chip devices)**: CLOSED - Phone Play shipped server-authoritative (§F).
- **Recorded workflow**: CLOSED - Race Pack mode shipped (§D4).
- **Stripe refund live rehearsal**: still BLOCKED at the same boundary (§I3).
- **Server deployment for API features**: still a decision for Saj - GitHub Pages
  carries the static demo only; Phone Play and card donations need the server shape
  hosted somewhere with `STRIPE_*` env vars. No provider was selected or configured,
  per the boundary.
