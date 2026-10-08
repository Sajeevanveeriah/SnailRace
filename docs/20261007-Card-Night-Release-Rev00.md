# Snail Race 5.0 - the card night

Prepared 7 October 2026 for the 24 October 2026 night. Rev00.

## What the room asked for, and what changed

| # | Comment | Change | Where |
| --- | --- | --- | --- |
| 1 | Simplify the UI/UX | Five projector screens, three desk panels, Admin for the rest | `components/ShowScreens.tsx`, `components/ModeratorDesk.tsx`, `lib/show.ts` |
| 2 | Remove the slithering sound; commentary optional | Crowd bed and noise reactions deleted; Music / Commentary / Off selector | `lib/audio/music.ts`, `lib/sound.ts`, `lib/event-store.ts` (`audioPatch`) |
| 3 | Snails 1 to 100, ten a race | `lib/card.ts`: number fixes race and lane; unsold snails race as "Snail N" | `lib/card.ts`, `components/Stage.tsx` |
| 4 | Owners name their snails | Roster on the desk and in Admin, paste import, CSV, Stripe fill, lock on arm | `components/RosterPanel.tsx`, `lib/card.ts` |
| 5 | Telecast viewport, leading pack by default | Camera frames leader to fourth, strip names runners behind the shot, full course toggle, locked finish | `components/Telecast.tsx` (`LEAD_PACK`) |
| 6 | Unpredictable, varied surprises | `DECK_CARDS`: nine late and field-wide cards, once-a-night dealt without replacement, reaches the finish straight | `lib/race-engine.ts`, `tests/deck.test.ts` |
| 7 | Fewer graphics | Ticker, splits, slate, on-air bug, goal ring, confetti, pit board, standings, reactions removed | `components/Stage.tsx`, `components/Telecast.tsx` |
| 8 | Quaddie on four races | Permit-gated quaddie, desk entries, live board after each leg, finale summary | `lib/quaddie.ts`, `components/QuaddiePanel.tsx` |
| 9 | $4 a snail, scan and pay | Stripe Payment Link at the card price with number, name and owner fields; paid snails fill the roster | `app/api/payment-link/route.ts`, `lib/stripe-read.ts` |

## Rev01: the side-on race

After the first release the club showed a reference of the look they want for the race itself: a side-on cartoon straight. `components/Sidescroller.tsx` replaces the oval on the race screen (the oval stays as an Admin option): parallax scenery drawn in code, ten large numbered snails, lead-pack camera, start and finish banners, a 1-to-9 progress bar and oversized surprise props. The engine, the plan hash and every other screen are unchanged.

## Assumptions taken without an answer

- The $4 snail is a named entry, not a stake: the app never pays it out. Cash prizes are the club's business off the app.
- The quaddie pays out, so it sits behind the same attestation gate as the cash tote.
- Unsold snails still race, under their number, so the card never has a gap.
- Phone Play, fun chips and Race Packs are off the projector and the desk but their code and routes remain, behind Admin.
- Plague at the Line is the only deck card the room described; the rest are new.

## Engine invariants kept

- One seed draws the complete plan before countdown; the commitment and plan hashes are unchanged in form. The deck is inside the plan hash because its cards are events.
- No lane clock ever runs backwards: two delays never overlap on a lane, boosts may overlap anything (`tests/deck.test.ts`).
- Per-lane consequence cap of 16% of race time still holds with the deck.
- Comeback beats slide to a free moment rather than stacking on a held lane, and are dropped if they cannot fit before the finish.

## Not done

- Finish Line Moves and Dead Heat from the mock: the first needs course geometry work, the second contradicts the unique-crossing rule.
- A Stripe-paid quaddie ticket: entries are recorded at the desk; a Payment Link allows only three custom fields and a quaddie needs four picks and a name.
