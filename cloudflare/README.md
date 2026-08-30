# SnailRace Cloudflare live service

This directory is the durable Phone Play backend for the static GitHub Pages
build. It is deliberately separate from donations: GitHub Pages continues to
say that card donations are unavailable, while Phone Play can use this Worker
when `NEXT_PUBLIC_LIVE_API_ORIGIN` is configured.

No package, lockfile, account change or deployment is included here. The
source has no runtime dependencies. Wrangler is required only when an operator
chooses to run or deploy it.

## What is durable

Each six-character room maps to one `RaceRoom` Durable Object. Player balances,
picks, operator transitions, settlement/void records and command receipts are
stored under separate keys in SQLite-backed Durable Object storage. Every
consequential mutation and its receipt is committed in one storage transaction.

The enforced lifecycle is:

`PENDING -> OPEN -> LOCKED -> RUNNING -> DRAWN -> SETTLED`

`LOCKED`, `RUNNING` or `DRAWN` may instead move to `VOID`; only an explicit
`rearm` moves that same race to a new `OPEN` attempt. A new race number is
accepted only after `SETTLED` or `VOID`. The field is exactly eight runners,
players start with 100 fun chips, each pick is capped at 100, and submitted
display odds are snapshotted at pick time. Neither this service nor its state
has monetary value.

Open the room before a countdown starts. A session request made against an
undrawn, closed `race` snapshot is refused; the service will not manufacture a
`RUNNING` state that lacks an acknowledged plan lock.

Stable command IDs are mandatory for state, lock, run, void, rearm, settle and
end. Replaying the same ID and payload returns its durable receipt. Reusing an
ID for different data returns `409`. Rooms retain up to 10,000 receipts for
their 24-hour lifetime: 6,000 are available to player picks and 4,000 are
reserved for operator commands. A single player may issue at most 100 distinct
pick commands. New commands are refused after those bounds rather than silently
forgetting idempotency history or allowing player traffic to starve settlement.
State, lock, run, void and rearm also require the last acknowledged
`expectedShowRevision`; the Worker never accepts a blind operator overwrite.

## HTTP contract

The Worker mirrors the frontend's existing routes:

| Method | Route | Authority |
| --- | --- | --- |
| POST | `/api/live/session` | allowed browser origin; creation rate limit |
| POST | `/api/live/join` | allowed browser origin; optional room PIN; join rate limit |
| GET | `/api/live/state` | room code; player ID plus bearer token optionally identify `you` |
| POST | `/api/live/pick` | player ID/token; market must be `OPEN` |
| POST | `/api/live/react` | player ID/token; 1.5-second durable throttle |
| POST | `/api/live/state` | operator bearer token; revision and monotonic checks |
| POST | `/api/live/lock` | operator bearer token; plan hash and show revision |
| POST | `/api/live/run` | operator bearer token; same plan hash and show revision |
| POST | `/api/live/void` | operator bearer token; atomic fun-chip refunds |
| POST | `/api/live/rearm` | operator bearer token; new attempt of the same race |
| POST | `/api/live/settle` | operator bearer token; one winner and one payout pass |
| GET | `/api/live/summary` | operator bearer token |
| POST | `/api/live/end` | operator bearer token |
| GET | `/healthz` | no room data |

JSON mutation bodies are capped at 16 KiB. Missing, opaque and foreign Origins
are rejected for every POST. CORS preflights allow only `GET`, `POST` and the
`Authorization`, `Content-Type`, `Cache-Control` and `Pragma` headers used by
the current no-store clients. The response echoes only an exact origin from
`ALLOWED_ORIGINS`; there is no wildcard mode. Operator capabilities are
accepted only as `Authorization: Bearer ...`; they never belong in URLs.

At 24 hours the room alarm deletes player, operator, pick and receipt data and
keeps only a tiny code/expiry tombstone. Later callers still receive `410`
rather than an ambiguous `404`, which lets a client reconcile a lost end
response without retaining credentials.

`RateGate` objects apply durable per-Cloudflare-source limits of 10 room
creations per hour and 360 join attempts per 15 minutes. The latter admits a
full 300-player room plus retry headroom when an entire hall shares one NAT
address, while still bounding invalid-code floods across rooms. Player auth,
room capacity, reaction throttling and the receipt bound provide the inner
limits. Cloudflare must remain the public ingress so `CF-Connecting-IP` cannot
be forged by an upstream client.

## Local contract probe

Node 24 can execute the TypeScript sources without adding a loader:

```sh
node --experimental-strip-types cloudflare/test/contract-probe.ts
```

The probe supplies in-memory implementations of the small Durable Object
interfaces. It exercises CORS, creation, join, pick, acknowledged lock/run,
late-pick rejection, exact settlement, receipt replay, wrong-winner conflict,
void/refund/rearm, read-only GET behaviour, the shared-NAT ceiling and a
129-player settlement that crosses the storage API's 128-key batch boundary.
It also races expiry against state, join and settlement requests and verifies
that the final room is only a `410` tombstone. It is not a substitute for a
Wrangler local or deployed load test.

## Operator deployment hand-off

Deployment changes Cloudflare account state and therefore remains an explicit
operator action.

1. Set `ALLOWED_ORIGINS` to exact browser origins. For a project site at
   `https://example.github.io/SnailRace`, the Origin is
   `https://example.github.io` - do not include `/SnailRace` and do not use `*`.
   Include `http://localhost:3000` only for a deliberate local session.
2. From this directory, authenticate the approved Wrangler installation with
   `wrangler login`.
3. Run locally with
   `wrangler dev --var ALLOWED_ORIGINS:http://localhost:3000`.
4. Run the contract probe, then a browser rehearsal against the local Worker.
5. Deploy with an explicit production value, for example
   `wrangler deploy --var ALLOWED_ORIGINS:https://example.github.io`.
6. Check `https://<worker-origin>/healthz` and record the exact HTTPS Worker
   origin without a trailing slash.
7. Add that origin as the GitHub repository Actions variable
   `NEXT_PUBLIC_LIVE_API_ORIGIN`, then rebuild and publish Pages. The existing
   Pages workflow passes this variable into the static build.
8. Rehearse create, join, pick, lock, run, settle, void/rearm and end from the
   real Pages origin before admitting an audience. Keep request-header and body
   logging disabled unless bearer capabilities and player tokens are redacted.

To roll back Phone Play on Pages, clear `NEXT_PUBLIC_LIVE_API_ORIGIN` and
republish. The static UI then makes zero live API calls and truthfully presents
Phone Play as unavailable. This does not enable Stripe on Pages.

## Capacity and remaining operational risks

This architecture removes the single-Node JSON-file race and needs no external
database. It does not promise that a particular Cloudflare account remains
free: plan availability and quotas must be checked before the event. The
current phone client polls every two seconds, so a large room should be load
tested against the chosen account limits. Hibernating WebSockets are the next
cost-reduction step if sustained large audiences are required.

Player and operator capabilities travel in an `Authorization` header for read
requests and player capabilities are inside validated JSON for picks and
reactions; secret capabilities are not put in URLs. Worker observability is
still disabled by default. Do not enable verbose request-header or body logging
until its redaction behaviour has been verified against the deployed account's
logging configuration.

GitHub Pages CORS is origin-wide: `/SnailRace` is not an Origin boundary. The
existing event store also persists the operator capability in origin-scoped
browser storage. If the same `owner.github.io` origin serves any other site, a
compromise in that sibling site can cross the project-path boundary. Use a
dedicated custom production origin for the event site, or treat every sibling
project on the shared origin as part of the same security boundary.
