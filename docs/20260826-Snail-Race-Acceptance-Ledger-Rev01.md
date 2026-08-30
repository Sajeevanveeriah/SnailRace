# Snail Race Fundraiser - Acceptance Ledger

> **Historical snapshot - superseded 30 August 2026.** This file is preserved
> unchanged below as evidence for an earlier build. Its runner counts, surprise
> semantics, finish lifecycle, chip-pricing/hosting descriptions and quoted
> test results are not evidence for the current consequential eight-runner
> release. Use the repository `README.md` and
> `docs/20260830-Operator-Runbook-Rev01.md` for current behaviour.

Date: 26 August 2026, verified 27 August 2026. Revision: Rev01. Each row is a requirement from Master
Prompt 3, its acceptance test, and its status. Status values: PASS (fresh evidence
this session), BLOCKED (external boundary, stated), DEVIATION (built differently,
rationale given), PENDING (not yet verified).

## A. Modes and states

| ID | Requirement | Acceptance test | Status |
|----|-------------|-----------------|--------|
| A1 | Live mode has clear ready/countdown/running/finished/void states | State banner visible on stage in each phase; void reachable from countdown and running; screenshots | PASS. E2E: READY/COUNTDOWN/RUNNING/FINISHED/VOID banners asserted; screenshots 01, 04, 05, 08. |
| A2 | Recorded mode: play/pause/seek, changing frames, elapsed/remaining | Archive replay of a completed race: scrub forwards/backwards, pause/resume, end, reset | PASS. E2E: play advances, pause holds, seek forwards and backwards exact, end announces winner, reset rewinds. |
| A3 | Recorded mode accepts verified media | Attach a file, SHA-256 recorded; re-attach verifies; corrupt file refused with explicit state | PASS. E2E: first attach fingerprints SHA-256; tampered file refused with explicit failure; genuine re-attach verifies. |
| A4 | Recorded mode synchronises race metadata/results and recovers after reload | Replay shows seed, result, highlights on a timeline; reload restores archive and playback position | PASS. E2E: seed, result and highlight timeline shown; reload reopens the same race at the same position. |
| A5 | Completed-race archive: event/date/race grouping, result summary, replay availability, audit metadata | /archive renders grouped history with seeds, hashes, void status | PASS. E2E + screenshot 09: day grouping, result summary, seeds, hashes, void status, replay links. |

## B. Determinism and audit

| ID | Requirement | Acceptance test | Status |
|----|-------------|-----------------|--------|
| B1 | Outcomes deterministic and auditable per seed; hidden until start | Unit test: same seed, same order, every field size; seed drawn at start, never before | PASS. 25-check unit suite: same seed same order at every field size; arrival order equals draw with surprises on across seeds and fields 3 to 20; winner uniform within 5 percent over 30,000 draws. |
| B2 | Seed commitment, configuration, timestamps, result hash recorded | History entry carries commit hash, config, startedAt/finishedAt, result hash; Verify Draw replays | PASS. Unit + E2E: commitment and result hash recorded with config, lockedAt/startedAt/finishedAt and odds snapshot; Verify draw recomputes both. |
| B3 | No moderator changes after lock without visible void/re-run audit entry | Race setup disabled while armed/running; void writes an audit entry the console shows | PASS. E2E: set-up disabled while armed/running with LOCKED notice; void writes a visible audit entry. |

## C. Fun chips (play money only)

| ID | Requirement | Acceptance test | Status |
|----|-------------|-----------------|--------|
| C1 | No chip purchase, cash-out, exchange, monetary value or donation-linked advantage | Code audit: no path from cents to chips or back; label present | PASS. Code audit: no path between cents and chips; threat model T15; labels verified on screen. |
| C2 | Selections locked before start; odds snapshotted | Bets refused once locked (unit + UI); odds stored per bet and per race at lock | PASS. E2E: bets refused after lock (stale tab included, re-checked at write time); odds stored per bet and snapshotted per race at lock. |
| C3 | Settle exactly once | Unit test: double settlement is a no-op; finished race is not re-settled on re-entry | PASS. Unit: double settlement is a no-op even against a different winner; E2E: finished race never re-settles, undo/re-run settles exactly once. |
| C4 | Undo via auditable compensating action | Undo marks the race void with a reason, restores snapshots, writes audit entry; nothing deleted | PASS. E2E: undo marks the race void with a reason, restores snapshots, reopens bets, writes race_undone; nothing deleted. |
| C5 | Concurrency/idempotency tested | Two-tab contention E2E; unique bet ids; store re-merges before writes | PASS. E2E two-session contention: both bets survive; store re-reads persisted state before functional writes; unique ids. |
| C6 | FUN CHIPS - NO MONETARY VALUE label wherever selections, odds, settlement or leaderboards appear | Visual check on bet slip, winner card, settlement panel, tote odds footnote, archive | PASS. Labels on bet slip, chip leaderboard, winner card, settlement panel, tote footnote, archive. Screenshots 01, 05, 09. |

## D. Stripe and security

| ID | Requirement | Acceptance test | Status |
|----|-------------|-----------------|--------|
| D1 | Webhook signature verification, replay/idempotency | Bad signature 400; unsigned 400; replay harmless (cache-bust only); unit/E2E | PASS. API suite: unsigned 400, bad signature 400, stale signature 400, valid HMAC accepted, replay idempotent. |
| D2 | Origin/CSRF boundaries | Foreign Origin on /api/checkout and /api/payment-link refused; redirect URLs never attacker-controlled | PASS. API suite: foreign Origin refused 403 on checkout and payment-link; redirect URLs only from own origin or NEXT_PUBLIC_SITE_URL. |
| D3 | Amount/event validation | Bounds and type checks unit-tested | PASS. API suite: amount bounds, lane bounds, malformed body all refused 400. |
| D4 | Refund reconciliation | Refunded charge voids/reduces the board entry; visible in ledger and CSV | PASS (logic) / BLOCKED (live). Unit: full refund voids the entry, partial refund nets down, charge expanded from the session. A live-Stripe round trip needs real keys, which this session must not configure. |
| D5 | Failure states; never trust client success redirects | Offline pill; thanks page confirms server-side; failed/delayed payment states shown | PASS. API + E2E: Stripe failure surfaces 502 without crash; offline pill keeps last snapshot; thanks page confirms server-side and invents no amount. |
| D6 | Secret handling | No secrets client-side or in repo; static export carries none | PASS. Secrets server-env only; static export built with app/api removed; no NEXT_PUBLIC secret; .env gitignored. |

## E. Surfaces and operations

| ID | Requirement | Acceptance test | Status |
|----|-------------|-----------------|--------|
| E1 | Projector: full-bleed race, race id, state banner, lap/progress, leaderboard, commentary, minimal chrome | Screenshot review at 1080p | PASS. Screenshots 01, 04, 06, 14 at 1920x1080: full-bleed race, race id, state banner, lap and clock, running order, call strap. |
| E2 | Moderator console: setup, lanes, lock/start/void/reset, donations, cash, settlement, audit trail, backup, reporting | Screenshot + walkthrough | PASS. Screenshots 02, 03, 07: setup, lanes, lock state, cash tin, settlement panel, audit trail, backup, exports, verify. |
| E3 | Phone: event confirmation, race, snail, amount, locked confirmation, result | Screenshot + walkthrough of /donate and /donate/thanks | PASS. Screenshots 12, 13: event confirmation, race number, snail selection, amounts, graceful failure states, no-token screen. |
| E4 | QR state size | Token measured at 20 lanes x 24-char names; renders and scans as QR | PASS. Unit: worst-case 20-lane token under 1,200 chars, inside comfortable QR capacity; round-trips; garbage never throws. |
| E5 | Offline/cash-only; backup/restore; CSV/print reconciliation | E2E: export CSV, save/restore backup, print sheet renders | PASS. E2E: donations CSV, audit CSV with hashes and trail, backup JSON carrying the audit; print sheet unchanged. |
| E6 | 20-lane long race performance and readable leaderboard | E2E long race at 20 lanes; frame health observed | PASS. E2E: 26.8 fps at 20 lanes under software rendering (was 5.3 before the aurora fix; GPU-composited hardware runs far higher); running order stays at six readable rows. |
| E7 | Calm/reduced-motion, sound blocked, no speech voice | prefers-reduced-motion honoured; blocked-audio bar appears; caller greys out without voices | PASS. E2E: reduced-motion context races correctly; calm toggles; blocked-audio bar appears; caller disabled with zero voices installed. |
| E8 | Presenter-clicker keys | Space/PageDown start; PageUp/Esc reset/close; E2E | PASS. E2E: PageDown starts, Escape resets, Space starts, Esc closes the card. |
| E9 | Static Pages mode with zero unavailable API polling | Static build serves; no /api requests observed in E2E | PASS. Static E2E: zero /api requests across a full session including a race and a replay; cash-only stated on screen. |

## F. End-to-end scenarios

| ID | Scenario | Status |
|----|----------|--------|
| F1 | New event, two completed races, championship standings | PASS. Two full races, settlement, standings after two races. |
| F2 | Lock contention from two sessions | PASS. Two sessions bet concurrently, both survive; second session locked out after start. |
| F3 | Reload projector/moderator in ready, locked, running, finished | PASS. Reloads in ready, running (locked) and finished: nothing invented, nothing double-settled, Reset recovers. |
| F4 | Webhook replay, refund, failed donation, delayed confirmation | PASS (webhook replay, failed donation, delayed confirmation) / BLOCKED (live refund round trip: needs real Stripe keys; logic unit-tested). |
| F5 | Settle once, undo via compensating entry, re-run | PASS. Settle once, undo via compensating void entry, re-run settles the reopened bets exactly once. |
| F6 | Recorded race seek both ways, pause/resume, end, reset, missing/corrupt media | PASS. Seek both ways, pause/resume, end, reset; missing media prompts re-attach; corrupt media refused by SHA-256. |
| F7 | Sound blocked, no speech voice, reduced motion, calm mode | PASS. Blocked-audio bar, zero-voice caller grey-out, reduced motion, calm mode. |
| F8 | 20 lanes at long duration | PASS. 20 lanes at 30s: 26.8 fps under software rendering, leaderboard readable. |
| F9 | Static cash/fun-chip mode, zero API polling | PASS. Static export: full race and replay with zero /api traffic. |

## G. Deviations and blocked checks

| ID | Item | Detail |
|----|------|--------|
| G1 | Phone fun-chip placement | DEVIATION. The phone surface covers event confirmation, race, snail and amount for donations; fun-chip bets are placed at the stage/table. Cross-device chip sync requires a server-side store this no-database architecture deliberately lacks; building one is a deployment and scope decision reserved for Saj. |
| G2 | Live Pages URL fetch from this session | BLOCKED by the session's egress proxy (403 on github.io). Verified indirectly: the deploy workflow's own "verify the published site is live" step passed on the latest main run (2026-08-16). |
| G3 | Design reference fetches (formula1.com, racing.com, docs.stripe.com) | BLOCKED by the egress proxy. Adapted from established knowledge of those references: persistent race context and timing tower (F1 live timing), explicit live/replay/archive separation (F1 TV), results linked to replays (racing.com), webhook-driven idempotent fulfilment and untrusted success redirects (Stripe Checkout fulfilment docs). |
| G4 | Real-money wagering | PROHIBITED. Not implemented, not enabled, not deployable from this codebase. See threat model T15. |
