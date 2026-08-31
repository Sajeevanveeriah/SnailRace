# NDCC Snail Race Night - Operator Runbook

Rev01, 30 August 2026 (AEST). This is the current volunteer script for the
consequential 8-to-20-runner release. It supersedes Rev00.

The two rules that never bend:

- **Fun chips have no monetary value.** They are free, cannot be bought or
  cashed out, and never become a prize of value.
- **Donations never enter the race or chip maths.** Stripe and cash are gifts
  to the club. Every lane has the same fixed N.00-for-1 chip
  price regardless of donations or the room's other picks.

## 1. Choose the hosting shape

Do this before rehearsing, because it determines which phone features exist.

| Hosting shape | Phone Play | Card donations | Operator check |
| --- | --- | --- | --- |
| Next server | Co-located live API | Available with approved Stripe keys | Confirm the writable `SNAILRACE_DATA_DIR`, HTTPS origin and Stripe test/live mode |
| GitHub Pages only | Unavailable | Unavailable; cash can still be recorded locally | Confirm the UI says Phone Play and cards are unavailable and makes no live API calls |
| GitHub Pages + Cloudflare Worker | Durable Object live API | Unavailable; Worker is chips-only | Confirm `NEXT_PUBLIC_LIVE_API_ORIGIN`, exact `ALLOWED_ORIGINS`, `/healthz` and a real cross-origin phone rehearsal |

The Cloudflare deployment hand-off is in `cloudflare/README.md`. Cloudflare and
GitHub account changes are external operator actions; source being present in
the repository does not mean either service is deployed.

## 2. Before doors open

1. Open the projector stage at `/`, press **M**, and enter the event name,
   venue, date, sponsors and fundraising goal.
2. Choose and confirm 8 to 20 runner names. A live race will refuse any field
   outside that range.
3. Choose live animated or a rights-cleared recorded pack. For a recorded pack,
   reattach and fingerprint-check its media after any browser reload.
4. Run **Preflight** and resolve every `BLOCKED` item. Test sound, the presenter
   clicker, full-screen mode and reduced-motion behaviour where required.
5. If Phone Play is enabled, open the room and scan the displayed QR with a
   real audience phone. Make one free-chip pick, verify the projector summary,
   then clear rehearsal data. Never print, share or log the operator key.
6. Reconcile the displayed donation mode. A static Pages build cannot create
   Stripe sessions, even when its Cloudflare Phone Play service is enabled.
7. Save an off-device backup of the configured night.

## 3. What happens when Start is pressed

This order matters. Do not tell the room that a race has started until the stage
has moved beyond any `LOCKING` or `HELD` state.

1. The stage draws one fresh seed and creates the complete locked
   plan before countdown.
2. The plan already contains every warning, reveal, effect, commentary cue,
   persistent advance or delay, any rare safe retirement, the first finisher,
   and the complete stop-frame classification.
3. The stage hashes both the locked configuration and the full plan, closes
   selections and writes the lock to the audit trail.
4. With Phone Play, the server must acknowledge `LOCKED` for that race number,
   attempt and plan hash, then acknowledge `RUNNING`. Only then does the
   projector begin countdown.
5. The race animation instantiates the locked plan. It does not draw a second
   result or add an uncommitted competitive event at runtime.

Donations, chip picks, pick popularity and reactions are not read by this path.

## 4. Run the show

Use **Space** or the clicker's forward button to move through lobby, racecard,
market, race, result, championship, optional intermission and finale. **M**
opens the console. Keep the operator controls off the projector image while the
race is running.

| Stage | What the room sees | Operator action |
| --- | --- | --- |
| Lobby | NDCC crest, event information, rules, join/donation access where available | Welcome the room and say that chips are free and donations have no return |
| Racecard | Every named runner | Introduce the runners and sponsor |
| Market | Free-chip pick bars and the same fixed N.00 price on every lane | Open or count down the market; do not describe donations as stakes or a pool |
| Locking | Selections closed while the plan and any remote lifecycle are acknowledged | Wait; do not restart or change the field |
| Countdown | Locked runners and committed plan | Call the start |
| Race | Broadcast field, running order and four-beat surprises | Let warning, reveal, effect and commentary land in sequence |
| Finish | The exact first-crossing frame and winner | Stop immediately - there is no wait for trailing runners |
| Result | Winner plus complete classification | Continue after the result card and chip settlement are visible |

### Immediate finish rule

The first active runner crossing is the end of the race. The animation freezes
at that exact plan time, the winner is announced immediately, and the result
card follows after no more than 450 ms. Active trailing runners are classified
by progress at the freeze frame. A safe retirement is marked `RET` with its
reason and ranks after active runners.

Never wait for all runners to reach the line, and never manually infer a
second result from later animation: there is no later animation.

## 5. Consequential surprise theatre

Each locked surprise has four audience beats:

1. **Warning** - something is developing on the course.
2. **Reveal** - the incident and affected runner or runners are identified.
3. **Effect** - the plan applies its persistent clock advance, delay or safe
   retirement.
4. **Commentary** - the caller explains what changed.

A surprise can therefore change who wins; it is not a decorative wobble that
returns to zero at the line. The fairness boundary is that the full consequence
was seeded, classified and hashed before countdown, not that surprises are
powerless. At most one rare family-safe retirement may appear in a race.

## 6. `HELD`, void and recovery

### If the stage says `HELD`

An acknowledgement may have reached the server even when its response did not
reach the projector. The app therefore fails closed:

1. Keep selections closed.
2. Keep the stage open; do not change names, draw another seed or use a browser
   refresh as a recovery shortcut.
3. Use **Retry lock**. It reuses the same plan, plan hash, race attempt and
   stable command identity so the server can return its original receipt.
4. Continue only after both `LOCKED` and `RUNNING` are acknowledged.

### If a race must be abandoned before the first finisher

1. Use the moderator's **Void race** action and enter the real reason.
2. The local animation freezes. No result and no chip settlement are created.
3. With Phone Play, wait while the server atomically refunds that attempt's
   picks and acknowledges `VOID`, then explicitly acknowledges `REARM` for the
   same race number with a new attempt.
4. Selections reopen only after safe rearm. If acknowledgement fails, the
   market stays closed; recover the connection and retry rather than changing
   local ledgers by hand.

After the first finisher, use the audited undo/compensating path for a recorded
result error. Do not delete history.

## 7. If a device or service fails

- **Projector browser closes:** reopen the stage and inspect the audit/history
  before acting. Do not assume an in-flight remote command failed merely
  because the browser missed its response.
- **Node live service is unreachable:** keep the market closed. Confirm the
  same data directory and service instance before retrying.
- **Cloudflare live service is unreachable:** keep the market closed. Check
  `/healthz`, the exact Worker origin and its configured browser-origin
  allowlist. Use platform logs without exposing operator or player tokens.
- **Pages has no configured Worker:** Phone Play is unavailable by design. The
  projector, local free-chip flow and cash recording can still run.
- **Stripe is unavailable:** do not promise that a card donation landed. Use
  Stripe's own dashboard as the card ledger; the chip system remains unrelated.
- **Recorded media is missing after reload:** reattach the original file and
  pass its fingerprint check before playback.

## 8. End of night

1. Close Phone Play and wait for the acknowledged end state.
2. Export donations and audit data, save a backup, print the report and archive
   the night.
3. Reconcile card donations against Stripe and cash against the cash tin.
4. Keep chip reports separate from every dollar report. Chips are never a
   receipt, stake, refund, prize or entitlement.
5. Publish or retain the final audit head if the club wants stronger
   tamper-evidence outside the operator laptop.

## 9. Release gate before a real event

From the repository root, run:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

For a Cloudflare deployment, also run the contract probe and a real browser
rehearsal against the deployed Worker from the deployed Pages origin. Test the
actual projector resolution, a representative phone, reduced motion, `HELD`
recovery, void/rearm and the immediate first-finisher result.

This runbook states required checks; it does not claim that fresh browser or
deployed-service evidence already exists for a particular commit.
