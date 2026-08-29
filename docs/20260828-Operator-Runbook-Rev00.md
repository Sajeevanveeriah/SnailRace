# Snail Race Night - Operator Runbook

Rev00, 28 August 2026. One volunteer, one laptop, one projector. Everything in this
runbook is driven from the stage (`/`) and its console (press **M**), and the whole
night advances on one button: **Space**, or the forward button of a presentation
clicker.

The two rules that never bend:

- **Fun chips have no monetary value.** They cannot be bought, sold, converted or
  exchanged, and a donation never buys chips or advantage. The screens say so
  everywhere; keep it true out loud too.
- **Nothing can reach the draw.** Donations, chips, reactions and the console all
  write ledgers; the finishing order comes from the published seed alone (live mode)
  or the pack locked before the night (recorded mode).

## 1. The week before

1. Open the stage, press **M**, and set up the **Event** panel: club name, event
   name, date, venue, sponsors, goal.
2. **Run of show** panel: event mode (live animated / recorded pack), races on the
   card, surprise director preset. Calm/Standard/Big Night/Chaos change how much
   drama is dealt, never a result.
3. Recorded night only - **Race Pack** panel:
   - Start a pack, attach each race's video (it is fingerprinted with SHA-256 on
     attach), enter runners, the finishing order in the footage, source and licence.
     Only footage the club made or holds rights to may enter a pack.
   - **Lock pack and publish commitment.** The pack's SHA-256 goes to the audit
     trail; from then on a changed file, result or title breaks the stated hash.
   - Export the manifest JSON as your off-device copy.
4. Turn on **Rehearsal mode** and run the whole night once (next section). Then
   **Clear rehearsal** - races, chips and fun bets from the rehearsal are removed;
   set-up and any real donations stay.

## 2. An hour before doors

1. **Preflight** panel → *Run preflight*. Fix anything BLOCKED (it tells you exactly
   what and why); ATTENTION rows are judgement calls. Test the clicker with its
   button.
2. Sound: turn it on, run *Sound check*, set the room level.
3. **Phone Play** (server nights only): *Open Phone Play*. The join code and QR go
   on the lobby and market screens automatically. Scan it with your own phone once -
   that is the preflight's manual row. A PIN is optional; say it out loud, print it
   nowhere.
4. Recorded night after a reload: media files live only in the browser session, so
   *Attach and verify media* again - files are re-verified against the locked
   fingerprints, and anything that does not match is refused by name.
5. Press **F** for full screen.

## 3. The night, on one button

Each **Space** press advances the show; **PgUp/Backspace-arrow** steps back;
**M** opens the console from any screen.

| Screen | What the room sees | What you do |
|---|---|---|
| WELCOME | Title, rules, sponsors, join QR | Doors open. Read the room in. |
| RACECARD | The field, form facts vs flavour (labelled "for fun") | Introduce the runners. |
| MARKET OPEN | Tote, odds, the room's phone picks, join QR | *Lock in 60s* arms a countdown with 30/10/5 warnings, or *Lock now*. |
| RACE | Live race (or *Draw the next race* → *Play race* on a recorded night) | Space starts a live race. The market locked at the gate. |
| RESULT | Winner card, settled chips | Phones see the result and their outcome. Space continues. |
| CHAMPIONSHIP | Standings, 5-3-1 points | *Intermission* button when the room needs a break. |
| THANK YOU | Night champion, total raised, sponsors | After the last race on the card. |

## 4. When something goes wrong

- **Wrong result recorded / race must be undone**: Console → Results → *Undo last
  race*. It writes a compensating void entry - chips and streaks restore from
  snapshots, bets reopen, nothing is deleted.
- **Recorded race won't play or plays wrong**: *Void race* during playback - it
  stays eligible for a re-draw, and the void is in the ledger.
- **Browser or laptop dies mid-night**: reopen the stage; the night lives in
  localStorage. Phones reconnect themselves with their saved identity. Recorded
  media needs re-attaching (fingerprint-verified).
- **Storage suspect / moving laptops**: *Save backup* (JSON) any time; *Restore
  backup* on the other machine. Restores are audited, and a backup that does not
  parse is refused rather than wiping the night. *Saved nights* keeps whole nights
  on-device behind a SHA-256 integrity check.
- **Doubt in the room**: *Verify draw* replays any seed; *Verify the hash chain*
  proves the audit trail unedited. Both run in front of the room.

## 5. After the night

1. Console → End of night: *Export donations CSV*, *Export audit CSV*, *Save
   backup*, *Print report*. Chips never appear next to dollars in any of them.
2. Card donations reconcile against the Stripe dashboard; refunds there net off the
   board on its next read.
3. *Save this night to the archive*, then *Start a brand new event* when the next
   night is planned.

## 6. What this app never does

No real-money wagering, odds payouts or cash prizes; no chip purchases; no path
between cents and chips (provably - see the acceptance ledger). Stripe is donations
only. If a regulator, the club committee or a punter asks: bets are free play-money,
prizes are glory, and every dollar is a gift to the club. Do not represent the app
as legally cleared - that judgement belongs to a person, not this code.
