# Snail Race Fundraiser - Readiness Conclusions

Date: 27 August 2026. Revision: Rev00. Basis: the acceptance ledger
(20260826-Snail-Race-Acceptance-Ledger-Rev01.md), the threat model
(20260826-Snail-Race-Threat-Model-Rev00.md), 30 unit tests, 18 API security
checks, 68 browser end-to-end checks, 6 static-mode checks, and 19 inspected
screenshots, all from this working tree.

## 1. Static play-money demo (GitHub Pages) - READY

The static export runs the complete night with cash and fun chips only: races,
lifecycle states, void, audit block, undo, archive and replays, with zero
requests to any API. Verified end to end against a static server under the
/SnailRace base path. The deploy workflow is unchanged and its live-site check
passed on the latest main run. Ship when approved.

## 2. Live club fundraiser with donations (server deployment) - READY,
     with three conditions

The code is ready: Stripe checkout, webhook signature verification with replay
idempotency, origin/CSRF refusal, amount validation, refund netting, failure
states, and no trust in client redirects are all verified. Conditions before a
real night:

- a. Run one rehearsal against Stripe TEST keys on the real deployment,
  including one live refund, to exercise the one path this session could not
  (it holds no Stripe credentials by design). The refund logic is unit-tested.
- b. Keep the stage device in club custody all night; anyone at its keyboard
  is the moderator (threat model, residual risks).
- c. Deploy behind a host that rate-limits (Vercel does); no server-side rate
  limiting is implemented in-app.

## 3. Recorded-race mode - READY

Deterministic replays reconstruct any completed race exactly from its seed and
locked configuration, with play/pause/seek both ways, elapsed/remaining time,
synchronised results and event timeline, reload recovery, and an archive that
links every result to its replay. Attached recordings are SHA-256-fingerprinted
at ingest and verified before playback; corrupt or substituted files are
refused with the reason on screen. Known limit, stated on screen: media files
are not stored in the browser, so a reload asks for the file again and
verifies it.

## 4. Real-money wagering - PROHIBITED, NOT BUILT, NOT READY

Nothing in this codebase implements, enables or can be configured into
real-money wagering, odds payouts in currency, chip purchase, cash-out or
prizes of value, and this must remain so until Australian legal, licensing,
age, geo, responsible-gambling, payment-provider and club approvals are
independently confirmed - none of which this repository can grant. Every
surface that shows selections, odds, settlement or leaderboards carries
FUN CHIPS - NO MONETARY VALUE. Donations remain gifts with no return and are
labelled "not a wager" at the point of payment.
