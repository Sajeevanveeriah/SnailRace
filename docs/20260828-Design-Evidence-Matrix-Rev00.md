# SnailRace v4 - Design Evidence Matrix

Date: 28 August 2026. Each row: reference, the useful mechanic, why it helps
SnailRace, and the original NDCC implementation. Protected expression is never
copied; money mechanics that conflict with the FUN CHIPS boundary are recorded
as rejected. Direct fetches of several sites are egress-blocked from this
session; where so, evidence came from web-search summaries and is marked (S).

| Reference | Useful mechanic | Why it helps | Original NDCC implementation |
|---|---|---|---|
| Fundeo race nights (S: fundeo.com/race-nights, /race-night-demo) | A night is a CARD of 4/6/8/10/12 pre-recorded races with personalised racecards and per-race sponsors | Gives recorded mode a real event shape instead of "play a file" | Race Pack manifest with 4 to 12 races, per-race sponsor, printable racecard, pack-level lock and audit commitment |
| Fundeo (S) | Tote window opens, closes before the off, results then settlement | The market rhythm is what makes a room lean in | Fun-chip market phases with 30/10/5 second caller warnings, lock, odds snapshot, exactly-once settlement. REJECTED: cash tote tickets, runner auctions, prize returns - all value paths are prohibited here |
| Fundeo virtual host "Peedy" (S) | A host character carries the night | A voice and a rhythm make it a show | ORIGINAL race-caller segments only (welcome, rules, racecard, sponsor, warnings, results, finale) using the existing synthesised caller; no parrot, no third-party character or voice; no new mascot invented without Saj's approval |
| Creature Dash (S: creaturedash.com FAQ) | Set up event, customise runners, race with random fair outcome | Confirms the fairness-first framing audiences accept | Already core: seeded uniform draw published as seed plus commitment; runner identity editing kept |
| Race-night DVD ecosystem (S: racenightshop, racenights.net) | 8 runners called by number; ~5 min races; printable tickets; optional compere | Field-size and pacing conventions that rooms already understand | Default pack race shape 8 runners; printable racecard through browser print; caller optional and degradable |
| Saj portfolio (source-inspected clone of sajeevanveeriah.github.io) | Archivo 400/600/800, warm paper ground, hairline rules, 11px/.15em uppercase eyebrows, 44px targets, visible focus, restraint | The quality benchmark for hierarchy and polish | SnailRace keeps its own theatrical stage identity but adopts the same discipline: consistent eyebrows, focus states, spacing scale, no decorative additions; no portfolio content copied |
| Stripe Checkout docs (egress-blocked; established knowledge + prior v3 verification) | Webhook-driven fulfilment, signed events, idempotent handling, no redirect trust | Already the v3 model | Preserved unchanged; re-verified by the API suite |
| WCAG 2.2 AA (w3.org egress-blocked; established knowledge) | Focus visible, target size, no colour-only info, reduced motion | A hall includes everyone | Keyboard walk, focus-visible audit, automated axe pass, reduced-motion E2E |
| VGCCC Victoria (S: vgccc.vic.gov.au summaries) | Paid entry or prizes of value drag an activity into permit territory; free entry with no value at stake sits outside it | Confirms the fail-closed boundary | Fun chips remain valueless and free; donations remain gifts; no prize-of-value features (e.g. runner auctions) are built; the app claims no legal compliance - the club must confirm its own position |

NDCC brand note: the operating guide names Maroon and Chevron Blue as primary
with Gold for emphasis, but no authoritative hex values or assets exist in the
repository. Rather than invent brand values, v4 keeps the shipped stage
palette (approved through v3) with gold as emphasis, and records this as a
DEVIATION awaiting official NDCC colour values.
