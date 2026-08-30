# Snail Race Fundraiser - Threat Model

> **Historical snapshot - superseded 30 August 2026.** This file is preserved
> unchanged below as evidence for an earlier build. Its runner counts, surprise
> semantics, finish lifecycle, chip-pricing/hosting descriptions and quoted
> test results are not evidence for the current consequential eight-runner
> release. Use the repository `README.md` and
> `docs/20260830-Operator-Runbook-Rev01.md` for current behaviour.

Date: 28 August 2026. Revision: Rev01 (supersedes Rev00, which remains in `docs/`
for history). Scope adds the v4 surfaces: the run-of-show screens, the Phone Play
server (`lib/live/store.ts` + `/api/live/*`), recorded Race Packs, the audit hash
chain, and the on-device night archive.

## System model - what changed since Rev00

- **New trust boundary 5 - audience phone to live server.** `/play` posts joins,
  picks and reactions to `/api/live/*`. Everything from a phone is untrusted; the
  phone is never authoritative for chips, results or settlement.
- **New trust boundary 6 - operator key.** The stage holds an unguessable operator
  key per Phone Play session. Only it can push show state, read the room summary,
  settle, or end the room. It never appears in a QR, player payload, or log line.
- **New asset A8** - the locked Race Pack commitment (the room's tamper evidence
  for recorded results). **New asset A9** - the audit hash chain.
- Boundaries 1-4 and the "money never meets chips" invariant are unchanged and
  re-verified this session (Rev01 evidence in the acceptance ledger Rev02).

## New and revised threats

| # | Threat | Asset | Mitigation | Status |
|---|--------|-------|------------|--------|
| T18 | Phone session impersonation: replaying another player's id | A3 | Per-player bearer token issued at join, compared timing-safe; wrong token gets a null `you` view and 401 on writes (unit + API tested) | Mitigated |
| T19 | Operator impersonation from the room: pushing show state, settling, ending | A2 A3 | Operator key required on every operator route, timing-safe compare, 403 otherwise; key stays on the stage device | Mitigated |
| T20 | Pick abuse: double spends via retried requests, replace-to-mint chips, negative or oversized stakes, stale-race picks | A3 | Nonce idempotency (same nonce = same answer), replace refunds the held stake first, integer bounds, bank check after refund, race/market staleness answered 409; settlement exactly-once with `already` on replay (unit + API) | Mitigated |
| T21 | Join floods and phone-number-style spam filling the room | A6 | Per-address bucket (20 joins / 5 min), 300-player room cap, 4096-byte body cap, origin allowlist on all live POSTs; reactions throttled per phone (1.5 s) into a capped ring buffer | Mitigated (host-level rate limiting still recommended for public deployments) |
| T22 | Reactions steering a race or a ledger | A2 A3 | Reactions land in an atmosphere buffer read only by the projector's decoration layer; no code path from reactions to engine, pack, chips or money | Mitigated by construction |
| T23 | Zombie rooms: the stage closes Phone Play but phones keep playing a headless session | A3 A4 | Operator close ends the session server-side; every later call answers 410 and phones display the end honestly (found by E2E this session; fixed with `/api/live/end`) | Fixed in this change |
| T24 | Recorded-result tampering: swapping media, editing the manifest, re-rolling the draw until a wanted race comes up | A2 A8 | Pack locked before the night with a published SHA-256 commitment over every race's runners, media fingerprint, duration and finishing order; media re-verified by fingerprint at attach (substitutes refused by name); each draw's seed and selection audited; voids audited and re-drawable | Mitigated - with the honest limit below |
| T25 | Audit-trail editing after the fact | A9 | Hash chain: `entryHash = SHA-256(prevHash + canonical entry)`; edit, removal, reorder or forged hash breaks verification at the offending entry (unit-tested per class); one-click verify in the console; chain exported in backups and CSV | Tamper-evident (see limits) |
| T26 | Malicious or corrupt backup/night restore wiping or seeding a night | A3 | Restores refuse unparseable or id-less payloads (fixed this session - previously a corrupt backup silently became a fresh night); saved nights verify a SHA-256 integrity fingerprint before loading; both paths audited | Fixed in this change |
| T27 | Live-store file tampering on the server host | A3 | Sessions persist as JSON under `SNAILRACE_DATA_DIR` with atomic writes; host filesystem trust is assumed, as with any single-server store. Chips only - no money at stake | Accepted (documented) |

## Honest limits, stated plainly

- The pack manifest, its sealed results included, lives on the operator's device.
  The commitment makes changes provable to the room; it does not hide results from
  someone who owns the laptop and inspects storage on purpose. The UI and runbook
  say exactly this.
- The audit chain is tamper-evident, not tamper-proof: the device's owner could
  rebuild the whole chain. Publishing the head hash off-device (a photo of the
  console, the exported CSV) is the club's control.
- The stage device remains the single point of trust (Rev00 residual, unchanged).
- Phone Play trusts the venue network for transport; it carries fun chips and
  display names only, so the blast radius of interception is atmosphere.
- Real-money wagering remains prohibited and unimplemented; the fail-closed stance
  from Rev00 T15 stands unchanged.
