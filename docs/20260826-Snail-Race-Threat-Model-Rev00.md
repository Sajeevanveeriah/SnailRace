# Snail Race Fundraiser - Threat Model

> **Historical snapshot - superseded 30 August 2026.** This file is preserved
> unchanged below as evidence for an earlier build. Its runner counts, surprise
> semantics, finish lifecycle, chip-pricing/hosting descriptions and quoted
> test results are not evidence for the current consequential eight-runner
> release. Use the repository `README.md` and
> `docs/20260830-Operator-Runbook-Rev01.md` for current behaviour.

Date: 26 August 2026. Revision: Rev00. Scope: the Next.js app in this repository,
its GitHub Pages static export, a server deployment with Stripe, and the club-night
operating model (projector stage, moderator console, donor phones).

## System model

- **Trust boundary 1 - donor phone to server.** The phone posts amount, lane, race
  and name to `/api/checkout`. Everything from the phone is untrusted input.
- **Trust boundary 2 - Stripe to server.** `/api/donations` reads Stripe (server
  key, outbound). `/api/stripe/webhook` receives inbound calls that anyone on the
  internet can attempt.
- **Trust boundary 3 - the room to the stage.** The stage and moderator console run
  on one trusted device. `localStorage` on that device holds the night: line-up,
  cash ledger, results, fun-chip book, audit trail. Anyone with the keyboard is
  the moderator.
- **Trust boundary 4 - the QR token.** The line-up token in the QR is unsigned by
  design. It carries names, not authority.
- **Money never meets chips.** Stripe holds real money (donations only). Chips are
  play-money integers in `localStorage` with no purchase path, no cash-out path and
  no exchange rate. These two systems share a screen and nothing else.

## Assets

A1 donated funds and the Stripe account. A2 the integrity of the draw (the claim
"donations and bets never influence the result"). A3 the night's ledger and its
reconciliation. A4 the club's reputation and legal standing (no unlicensed
wagering). A5 donor personal data (name, email held by Stripe). A6 availability of
the stage on the night. A7 secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).

## Threats and mitigations

| # | Threat | Asset | Mitigation | Status |
|---|--------|-------|------------|--------|
| T1 | Forged webhook calls mark payments or poison caches | A1 A3 | Signature verification via `constructEventAsync` with tolerance; webhook only busts a read-through cache, is idempotent under replay, and is never a source of truth (fulfilment = reading paid sessions back from Stripe) | Mitigated |
| T2 | Webhook replay | A3 | Handler is idempotent (cache bust only); Stripe SDK enforces timestamp tolerance | Mitigated |
| T3 | Client-crafted checkout: absurd amounts, negative cents, lane injection | A1 A3 | Server-side clamps: integer cents within $1 to $2,000, lane bounds, string sanitisation, race number floor | Mitigated |
| T4 | Cross-site POST to `/api/checkout` with attacker Origin, steering `success_url`/`cancel_url` to a hostile site (open-redirect-shaped CSRF) | A1 A5 | Origin allowlist: redirect targets come only from the deployment's own origin or `NEXT_PUBLIC_SITE_URL`; foreign origins are refused | Fixed in this change |
| T5 | Trusting the success redirect to confirm payment | A1 A3 | The thanks page reads the session back from `/api/session`, which checks `payment_status` server-side and only serves this app's sessions | Mitigated |
| T6 | Refunded card payments staying on the board and in the CSV, breaking reconciliation | A3 | `/api/donations` now expands `payment_intent.latest_charge` and voids or reduces entries by `amount_refunded`; voided entries remain visible in the ledger | Fixed in this change |
| T7 | Moderator (or anyone at the keyboard) altering a race after betting is locked | A2 A4 | Race setup is locked while a race is armed or running; changing it requires a void, which writes a visible audit entry; the seed commitment is published before the off and the result hash after | Fixed in this change |
| T8 | Rigged or re-rolled draws ("re-run until my snail wins") | A2 | Every start writes an audit entry with seed commitment and timestamps; a void or undo writes a compensating entry; the Verify Draw panel replays any seed; nothing can delete audit entries from the UI | Fixed in this change |
| T9 | Fun-chip settlement applied twice, or lost on a crash between settle and persist | A3 | Settlement is exactly-once by construction: settled bets are skipped, and a race whose number already heads the history is not settled again; undo is a compensating void entry that restores from pre-settlement snapshots | Fixed in this change |
| T10 | Two tabs or devices clobbering each other's writes to the night state (lock contention) | A3 | `setState` re-reads persisted state before applying a patch when another tab has written; bets and ledger entries carry unique ids | Mitigated (window reduced; single-writer stage device remains the operating assumption) |
| T11 | Tampered QR token misdirecting donations | A3 | Token is unsigned by design; blast radius is a wrong snail name on a real donation; moderator can reassign; token cannot reach the draw or the chips | Accepted (documented) |
| T12 | Secrets leaking to the client or the repo | A7 | Secrets are server-env only, never `NEXT_PUBLIC_*`; `.env*` gitignored; static export contains no key material; API routes are stripped from the Pages build | Verified |
| T13 | Session-id enumeration via `/api/session` | A5 | Only `cs_`-prefixed ids, only this app's sessions, only four display fields returned | Mitigated (ids are unguessable; rate limiting is the host's concern, noted) |
| T14 | Denial of the night: venue wifi dies, Stripe unreachable | A6 | Cash-and-chips mode is fully offline; last good snapshot kept with an explicit offline pill; static export never polls; backup/restore JSON | Mitigated |
| T15 | The app drifting into a wagering product (real-money bets, chip purchase, cash-out, paid odds) | A4 | Chips have no purchase, no monetary value and no cash-out anywhere in code; donations carry explicit "not a wager" copy; FUN CHIPS - NO MONETARY VALUE labels on every bet surface; this threat model and the readiness ledger record the prohibition | Enforced in this change |
| T16 | Recorded-media substitution (playing a doctored replay as if genuine) | A2 | Attached media is verified by SHA-256 recorded at ingest; mismatch refuses playback with an explicit failure state; the deterministic seed replay is always available as the authoritative reconstruction | Fixed in this change |
| T17 | XSS via names (backer, snail, sponsor) | A6 | React escapes all text; control characters stripped server-side; no `dangerouslySetInnerHTML` with user data (the only usage is a constant theme script) | Verified |

## Residual risks, stated plainly

- The stage device is a single point of trust. Anyone at its keyboard is the
  moderator. Physical custody of that laptop is a club-night control, not a code one.
- The audit trail lives in `localStorage` on that device and in exported backups.
  It is tamper-evident to the room (entries are visible and hashes replayable), not
  tamper-proof against the device's owner. That is the honest limit of a no-database
  design and is acceptable for play-money and donations, not for wagering.
- No server-side rate limiting is implemented; deploy behind a host that provides it
  (Vercel does) before a public event.
- Real-money wagering remains prohibited: no odds payouts in currency, no chip
  purchase, no prizes of value, until Australian legal, licensing, age, geo,
  responsible-gambling, payment-provider and club approvals are independently
  confirmed. Nothing in this codebase may be "switched on" to change that; it would
  require building what deliberately does not exist.
