# Snail Race Fundraiser - Readiness, Rev01

> **Historical snapshot - superseded 30 August 2026.** This file is preserved
> unchanged below as evidence for an earlier build. Its runner counts, surprise
> semantics, finish lifecycle, chip-pricing/hosting descriptions and quoted
> test results are not evidence for the current consequential eight-runner
> release. Use the repository `README.md` and
> `docs/20260830-Operator-Runbook-Rev01.md` for current behaviour.

Date: 28 August 2026. Covers the Master Prompt 4 change set (v4: run of show,
Phone Play, recorded Race Packs, surprise director, audit hash chain, cockpit,
preflight, night archive) on top of the shipped v3.

## Verdicts

- **Static GitHub Pages demo: READY.** Builds clean with `app/api` removed, runs
  the whole night offline on cash and chips, makes zero API calls (verified), and
  is truthful on `/play` about needing the event server.
- **Live club night on one laptop (no server): READY.** The full run of show,
  racecard, market countdown, races, settlement, undo, reports, backups, saved
  nights, audit chain - all verified end to end.
- **Live club night with Phone Play and card donations: READY once hosted.** The
  code is verified (48 API checks, multi-context E2E with two phones), but the
  server shape must be deployed somewhere that runs `next start` with
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` set and host-level rate limiting.
  Choosing and configuring that host is Saj's call - none was configured.
- **Recorded Race Pack night: READY** with the stated honesty: the manifest lives
  on the operator's device; the commitment is tamper evidence for the room, not
  secrecy from the laptop's owner. Media must be re-attached after a reload
  (fingerprint-verified) - the preflight checks it.
- **Real-money wagering: NOT BUILT, by design.** Fail-closed stance unchanged.
  Nothing here claims legal compliance; that judgement belongs to a person.

## Evidence (all fresh, this session)

| Layer | Result |
|---|---|
| Unit (`npm test`) | 71/71 - engine fairness, intensity invariants, migration, audit chain tamper classes, race-pack validation/commitment/draw, live store (idempotency, exactly-once, throttles, end-session), tote, Stripe read, standings, lineup |
| API (server A/B) | 18/18 Stripe + security; 30/30 Phone Play abuse suite |
| Browser E2E (v3 preservation) | 68/68 on the v4 build, 34.7 fps at 20 lanes (baseline 26.8) |
| Browser E2E (v4, multi-context) | 52/52 - projector + two phones, full run of show, recorded pack night with real video, tamper refusal, rehearsal, archive, chain verify |
| Static export E2E | 8/8, zero `/api` calls |
| Gates | `tsc --noEmit` clean; ESLint clean; both build shapes compile |

Screenshots: `qa/shots/` (v3 set, re-taken) and `qa/shots-v4/` (13 new screens)
in the session workspace; representative frames inspected by eye for layout and
tone.

## Defects found and fixed during this verification

1. Phones never saw results: `liveShow.raceNo` advanced the instant a race
   settled. Results phase now holds the settled race for the room.
2. Closing Phone Play left a zombie server room. Added `/api/live/end` (operator
   key), phones now told the event ended (410).
3. A corrupt backup restored as a silently fresh night. Restores now refuse
   unparseable payloads.
4. Recorded-mode winner card was empty (it read only the engine's results). It
   now falls back to the recorded ledger entry.
5. A brand-new event kept the previous night's running order on screen (component
   state survived the store reset). Cleared on event change.
6. Full-bleed show screens covered the header's Controls button. The show toolbar
   now carries Controls, and the console sits above the show layer.

## Section 31 - honest handoff

- Everything verified is listed above with counts; nothing is claimed beyond it.
- Not verified, with reasons: live Stripe refunds (needs real keys and a live
  charge - out of boundary); Phone Play on a genuinely hosted server and venue
  wifi (no host configured - decision pending); assistive-technology testing with
  a real screen reader (manual a11y checks and ARIA/focus/reduced-motion E2E only);
  long-haul soak (a 3-hour night with 300 phones) - the flood and throttle limits
  are unit/API-tested, not load-tested.
- Boundaries honoured: no Stripe configuration or transactions, no secrets, no
  hosting or database provisioning, no DNS. Release actions (push, PR, merge,
  deploy, verify) executed under Saj's explicit approval message for this change
  set.
