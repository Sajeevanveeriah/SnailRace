# 🐌 Snail Race Fundraiser

An interactive snail racing game built for **Newcomb & District Cricket Club** fundraising nights.

Open one file in a browser. No installation, no internet, no accounts. Put it on the big
screen, take donations at the laptop, and run races all night.

---

## Quick start

1. Keep `index.html`, `style.css` and `script.js` together in one folder.
2. Double-click **`index.html`**.
3. Press **`F`** for full screen, **`M`** for the controls, **`Space`** to race.

That's it. It works from a USB stick, a Downloads folder, or a shared drive.

---

## What's on screen

| | |
|---|---|
| **The track** | Six lanes (adjustable 4–8), each with its own coloured snail, a slime trail, a live position chip and the racer's name travelling with it. |
| **The tote board** | Who's backed, how much is on each snail, and how many backers — the number the room can see, which is the whole point. |
| **Raised tonight** | Running total with a goal bar. Crossing 25/50/75/100% gets a celebration. |
| **Seed** | The code the result was drawn from, shown *before* the race. See [Is it fair?](#is-it-fair) |
| **Controls drawer** | Everything the moderator needs, hidden from the crowd until you press `M`. |

---

## Running a fundraiser night

### Before people arrive

1. Press `M` to open the controls.
2. **Racers** — set how many snails (4–8) and name them. Player names, sponsor
   businesses, and in-jokes all work. "Suggest names" fills them with cricket puns
   if you're stuck.
3. **Target** — set tonight's goal so the bar means something.
4. **Race** — pick a race length. 10 seconds is the sweet spot; 15 gives you longer to
   work the crowd, 7 keeps things moving when you're running late.
5. Run one practice race and check it looks right on the projector.

### Taking donations

In the **Take a donation** panel: pick the snail, optionally type the backer's name,
enter the amount (or hit one of the `$5 / $10 / $20 / $50 / $100` buttons), press
**Add donation**.

- The **backer name is optional** — never hold up a queue for it. But if you capture it,
  the winner's card names the backers on the big screen, which is worth real money in
  atmosphere, and the club leaves with a list of people to thank.
- Every donation is tagged to a snail *and* to the race it's backing. Nothing is ever
  cleared or overwritten, all night.

### Fixing mistakes

Somebody will hand you $10 and you'll type $1000. That's fine:

- **Undo last entry** (or `Ctrl+Z`) reverses the most recent donation.
- **void** next to any row in the ledger reverses that one.
- Voided entries stay in the ledger marked `VOID`, so the books still balance and the
  treasurer can see what happened.

### Racing

Press **`Space`** (or the Start button). Countdown, race, winner card with the podium
and the backers' names, then it clears itself after about fifteen seconds — or press
`Esc`.

The tote board resets for the next race automatically. The night total keeps climbing.

### At the end

**End of night** panel:

- **Open report** — a clean printable page: night total, every race with its podium and
  pot, per-snail totals, the full donor list, and a sign-off line for whoever counts the
  cash. **Print / Save as PDF** prints just the report, black on white.
- **Export CSV** — the same data as a spreadsheet.
- **Save backup** — a `.json` file you can restore later on any machine.

---

## Is it fair?

Yes, and you can prove it on the spot.

The moment you press Start, the app shuffles the finishing order using a seeded random
draw and prints the seed on screen — **before any snail moves**. Everything you then
watch is animation playing out an already-decided result. The draw reads the seed and
the number of racers, and nothing else: the donation ledger is not in scope where the
draw happens and is never consulted.

Every snail wins exactly 1 time in N. This is verified in the test suite by running
60,000 draws and confirming a flat distribution, including with $500 stacked on one lane.

If somebody grumbles that the well-backed snail keeps losing, paste the seed from the
results list into **Verify draw** in the End of night panel. It re-runs the shuffle and
prints the order it produces — which will match what everyone just watched.

**Please note:** the races are decorative, not a simulation, and the outcome is a random
draw. Announce it as a bit of fun and a raffle-style draw, not a contest of snail skill.
If your club needs to treat the takings as gaming or wagering revenue rather than
donations, check your own obligations — this app just tracks who gave what.

---

## Keyboard shortcuts

| Key | Does |
|---|---|
| `Space` | Start the race (or dismiss the winner card) |
| `Esc` | Reset the race · close the winner card · close the report |
| `M` | Show / hide the moderator controls |
| `F` | Full screen |
| `N` | Day / night stage |
| `C` | Calm mode |
| `S` | Sound on / off |
| `Ctrl+Z` | Undo the last donation |

Shortcuts are ignored whenever you're typing in a field, so you can type a snail called
"Shell Warne" without launching a race.

---

## Display setup

**One laptop driving a TV or projector (the usual setup).** Mirror your display over
HDMI, press `F` for full screen, and keep the controls drawer closed with `M`. Open it
when you need to take a donation; close it again. Everything is sized with `clamp()`, so
it scales from a phone to a 1080p projector without a separate "big screen" build.

**Dark hall?** Press `N`. The track flips from cream to dark slate so a 2-metre white
rectangle isn't blinding the room, and the lane colours become luminous instead.

**Two devices?** Don't. The app keeps its state in the browser it's running in, so a
second copy on another device is a *separate, empty* event, not a remote control. Mirror
one screen over HDMI instead.

---

## Accessibility

- Race status and results are announced to screen readers via live regions.
- All text meets WCAG AA contrast in both day and night themes (verified in the test
  suite, including every lane colour).
- **Calm mode** (`C`) stops all decorative motion — the crawl cycle, confetti,
  slow-motion and celebration effects — while still running the race. `prefers-reduced-motion`
  is honoured automatically, but Calm mode exists because a borrowed club laptop almost
  never has that flag set.
- Every control is keyboard reachable with a visible focus ring, and buttons are sized
  for tapping.
- Colour is never the only cue: every snail carries its lane number and its name.

---

## Your data

Everything stays on the device. There is no server, no analytics and no network traffic
of any kind.

State is written to the browser's local storage after every change, so an accidental
refresh, a laptop sleep, or a closed tab does not cost you the night's takings — reopen
the file and it picks up where it left off. The **Saved 8:42 pm** stamp in the controls
drawer confirms it's writing. If it ever says it's *not* saving (some browsers block
storage for local files), use **Save backup** before you close anything.

Clearing your browser's site data will erase an event. Take a backup or a CSV before you
go home.

---

## Customising

**Club name and event title** — edit the two lines in `index.html`:

```html
<p class="club" id="clubName">Newcomb &amp; District Cricket Club</p>
<h1 class="event" id="eventName">Snail Racing Fundraiser</h1>
```

**Colours** — every colour is a custom property at the top of `style.css`. Change
`--green-700` and friends under `:root` for club colours; `[data-theme="night"]` holds
the dark-hall overrides. Lane colours are the `PALETTE` array at the top of `script.js`.

**Number of racers** — no code needed, it's a dropdown in the Racers panel (4 to 8).

**Add a club logo** — drop an `<img>` into the header block in `index.html`.

---

## Troubleshooting

**The race won't start.** If the controls drawer is open, click Start. If it's closed,
press `Space` — but only when you're not in a text field.

**A donation went in wrong.** `Ctrl+Z`, or hit **void** on that row in the ledger.

**The screen is blinding in a dark room.** Press `N`.

**The animation makes someone unwell.** Press `C`.

**Nothing saved / it says NOT SAVING.** Some browsers block storage for files opened
directly. Use **Save backup** regularly, or serve the folder over `http://localhost`
instead of double-clicking.

**It looks cramped.** Press `F` for full screen and close the drawer with `M`.

---

## Technical notes

- Three files, no dependencies, no build step, no framework, no CDN.
- Runs from `file://` — everything is inline, nothing is fetched.
- Verified in a headless browser: 15 consecutive races complete cleanly, the draw is
  uniform over 60,000 samples, finish geometry lands on the chequer to within a pixel,
  keyboard shortcuts stay out of the way while typing, state survives a reload, and
  contrast passes AA in both themes.
- Browser support: Chrome/Edge 105+, Firefox 121+, Safari 15.4+ (uses `color-mix()`,
  `dvh` and `:focus-visible`).

---

Made with ❤️ for Newcomb & District Cricket Club. Good luck on the night. 🏏🐌💰
