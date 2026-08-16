# Snail Racing Fundraiser

A complete fundraising night for the **Newcomb & District Cricket Club**: a projector
stage with animated snail races, live Stripe card donations by QR code, a parimutuel
tote board, play-money fun bets, and a moderator console that reconciles the whole
night to the dollar.

## The one claim that matters

**Donations and bets never influence the result.** The finishing order is drawn by a
seeded Fisher-Yates shuffle the instant Start is pressed, before a single snail moves.
The seed is printed on the stage; anyone can replay it afterwards from the console's
*Verify draw* panel and get the identical finishing order. Every snail wins with
probability exactly 1/N. The animation is theatre and is mathematically incapable of
changing the outcome (see `lib/race-engine.ts`).

That includes the surprises. A turbo boost or a mid-race nap is a displacement term
carrying an envelope that is exactly zero at the finish line, dealt from the same seed
*after* the order has already been settled, so it changes what the room sees and never
who wins. Turning surprises off does not change the finishing order for a given seed.

Backing a snail is a **donation with no return**, and the fun bets use **free play
chips with no cash payout** - which is what keeps the night a fundraiser rather than
a wagering product.

## Screens

| Route | Who it is for | What it does |
|---|---|---|
| `/` | The projector | Race stage, timing tower, tote board, goal ring, donation ticker, QR code, fun-bet slip, moderator drawer |
| `/donate` | A punter's phone | Opened from the QR code. Pick a snail, pick an amount, pay through Stripe Checkout (Apple Pay / Google Pay) |
| `/donate/thanks` | The same phone | Confirms the paid amount and snail straight from Stripe |

## On the projector

The stage is built for a hall, not a laptop. **The moment a race starts it goes
full bleed**: the tote board, the bet slip, the donation ticker and the header
stand down, and the course takes the whole screen with broadcast furniture over
the top, a big call along the bottom and the camera and lap in the corners. It
comes back between races, when the moderator needs the console again.

Measured on a 1080p screen, the race went from **47 percent of it to 100**.
Checked at 1280x800, 1366x768, 1920x1080 and 3840x2160: fills the screen at
every one, with no horizontal overflow.

The type scales with the screen rather than staying at laptop sizes, so the
commentary, the lap and the surprise banners are readable from the back.

## The circuit

The default track is a **closed course run over laps**, not a straight line. Three
courses ship - Club oval, Figure of eight and Country lane - each with its own scenery,
named stretches and a chequered start/finish line. Straight lanes are still there as a
**Track** option in **Controls**, and read better on a poor projector.

Laps are what make a race long without making it dull: a lap length times a lap count,
set separately, so the default **45 seconds a lap over 3 laps** is a 2m 15s race and
60 x 9 is a nine-minute epic. Each time the leader crosses the line there is a lap call,
and the last lap gets **the bell**.

**Pace matters more than it looks.** The oval is about 2,200 course units round and a
snail is 48 long, so a 12-second lap has them covering five body-lengths a second, which
reads as a sprinting animal rather than a snail. 45 seconds is about one length a second.
The console prints the resulting race length and pace next to the setting, so it is never
a surprise on the night.

### The camera

The frame is not fixed. A **director** cuts between shots the way a race broadcast does:

| Shot | When |
|---|---|
| `WIDE` | The establishing shot, and whenever the field is strung out |
| `PACK` | The default - frames every runner, so nobody loses their snail |
| `LEADER` | A close-up on the front |
| `BATTLE` | Two runners close together |
| `REACTION` | Cut to whoever a surprise just landed on |
| `FINISH LINE` | Locked on the line from the run home |

Shots hold for a few seconds and only a real event - a surprise, a lead change, the run
home - can break the hold early, so a cut always means something happened. A cut is
instant, and there is deliberately no flash frame over it: one was tried and reads as a
flicker on a projector, when a real cut is simply the next frame from a different camera. The sequence
is drawn from the race seed, so a replayed race is shot the same way. Name labels
counter-scale against the zoom, so a close-up never prints a name across the whole
projector. Turn the director off in **Controls** to hold the whole course in frame.

### How it is drawn

Flat fills at projector scale read as a wireframe, so the course is built up
the way ground actually is: mown turf underneath, a worn verge, the racing
surface with grain over it, painted edges and a dashed racing line, then a
soft vignette so the scene is lit from above rather than evenly. The stand has
a roof and a crowd with light in it, trees have canopies and shadows, and the
water has a highlight.

The snails are drawn in the order light hits them: the wet trail they are
sitting in, a contact shadow, the soft foot, the shell with its spiral and a
highlight, then eye stalks that lead into the turns. The trail sits inside the
rotated group, so it follows the heading instead of always pointing one way.

### Also on the circuit

- **A timing tower** under the track: live running order with gaps in seconds behind the
  leader, so there is something to read between the big moments.
- **Weather**, drawn from the seed: clear, drizzle or a downpour, with the track wet and
  the commentary calling it. Scenery only - it never touches a position.
- Fields from 3 to 20 all fit: lane spacing tightens as the field grows, and past twelve
  runners the field is labelled by number with the tote board carrying the names.

## Running the night

- **Race sponsors.** Type the list once in **Controls**, one per line. They are cycled a
  race at a time, so every sponsor gets an even share without anyone tracking whose turn
  it is, and the name appears on the stage, on the winner card, in the CSV and on the
  printed report with a thank-you line.
- **A championship table.** Points by finishing position across the night, 5 for a win,
  3 for a second, 1 for a third, so a consistent second beats one lucky win. It appears
  once two races have run and gives the moderator a reason to call a final. Standings are
  derived from the race history, so undoing a race corrects the table for free.
- **Presenter clicker.** PageDown and the right arrow start the next race, PageUp and the
  left arrow reset or close the winner card, which is what a wireless clicker actually
  sends from the front of a hall.
- **Undo the last race.** Removes the result, reopens that race's fun bets and puts the
  chip bank and streaks back exactly, from a snapshot taken before the race settled.

## Keeping the room in it

A race the crowd can look away from is a race they stop backing, so the night is built
to keep giving them reasons to look back.

- **Longer races.** Lap lengths from a 7-second sprint to a 60-second epic, times up to
  nine laps. The field's finishing gaps scale with the length, so a long race spreads the
  placings out instead of landing the whole field in one clump.
- **Surprises.** Turbo slime, second winds, shell slips, micro-naps and lettuce breaks,
  roughly one every three seconds of race - so a five-minute race carries a steady drip
  of them rather than four quiet minutes. On straight lanes each one is **marked on the
  track before it lands**, so the room can see a nap coming and shout at a snail about it.
- **Called out loud.** Every surprise gets a banner across the track, a sound cue and a
  commentary line. So does every change of leader, every lap crossing, and the bell lap.
- **A highlight reel.** The winner card lists what happened and when, so the punter who
  just lost on a nap at 8.1s knows exactly what to blame.
- **Streaks.** Two winning fun bets in a row starts a run, and every win after that pays
  bonus chips on top of the odds. The chip leaderboard shows who is on one.

Surprises can be switched off entirely in **Controls** if a room wants the plain race.

## Sound

There are **no audio files in this repo**, and that is deliberate. A club projector laptop
is exactly the machine that will fail to load three MP3s from a venue's wifi five minutes
before the first race, and music nobody recorded needs no licence - which matters when the
night is being projected in public and possibly streamed. So the whole soundtrack is
synthesised by WebAudio at the moment it plays.

- **A crowd bed** under everything, so the gaps between cues are a room rather than silence.
- **A lobby groove** between races, written low and sparse to sit under a moderator talking.
- **A race track that follows the race.** The arrangement thickens as the field comes home:
  bass from the gate, backbeat at the quarter, arpeggio at halfway, top octave and
  tambourine only in the run home. The room hears how far in it is without looking up.
- **The crowd answers the track.** Cheers on a boost, a groan on a nap, a roar into the
  final straight and at the line. Anything good rises in pitch and anything bad falls, so a
  punter at the bar with their back to the screen still knows what happened.
- **The music ducks** under the big moments so the commentary stays readable.

### The race caller

The commentary is also **spoken aloud**, which is what a room means by
commentary. It uses the browser's own speech synthesis, so it keeps the same
bargain as the rest of the audio: no files, no licence, no network.

The hard part is not speaking but *not* speaking. A race throws lines faster
than anyone can say them, so every line carries a priority: the big
moments - the off, a lead change, the bell lap, the winner - interrupt
whatever is being said, and the ordinary run of play is spoken only if the
caller is free and dropped otherwise, exactly as a human commentator drops a
line they no longer have time for. Everything the room reads is everything
the room hears; the two can never drift apart because they go through one
function.

**V** turns the caller on and off, or use **Controls → Sound**. A browser with
no speech voices installed simply shows the option greyed out and keeps the
written commentary.

Levels live in **Controls → Sound**: overall volume, music under the commentary, and a
**Sound check** button that plays every cue in order so you can set the room level cold,
before anyone arrives. **S** mutes everything, **B** drops just the music and crowd.

### If you cannot hear anything

Browsers will not start audio until someone interacts with the page, and they fail
**silently**, which is indistinguishable from an app that has no sound. So the stage says
which it is: if the browser is refusing, a red **"Sound is blocked - click here to turn it
on"** bar appears along the bottom, and clicking it is itself the gesture the browser was
waiting for. Failing that, press **Space** or click anywhere once, then use **Sound check**
in the console to confirm.

### Using your own music

Drop files into `public/audio/` and rebuild; each one found replaces its synthesised cue,
and anything missing falls back. The console lists what it found. See
[`public/audio/README.md`](public/audio/README.md) for the filenames, the licensing notes
and where to find CC0 tracks - and for the one trade-off, which is that a supplied
`race.mp3` is a fixed loop and cannot follow the race the way the built-in track does.

## How money flows

- **Cards**: the phone page creates a Stripe Checkout Session tagged with the event,
  race and lane. The stage polls `/api/donations`, which reads paid sessions straight
  back from Stripe. **Stripe is the ledger** - there is no database to drift from the
  bank statement.
- **Cash**: recorded in the moderator console on the stage device, kept separately,
  exported in the same CSV.
- **Refunds**: refund the payment in the Stripe dashboard; it leaves the board on the
  next poll. Cash entries are voided, never deleted, so the ledger always reconciles.

## Running it

```bash
npm install
npm run dev        # develop
npm run build      # production build
npm start          # serve the production build
```

Set the environment (see `.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | For card donations | Without it the app runs in cash-only mode and says so on the stage |
| `STRIPE_WEBHOOK_SECRET` | Optional | Speeds up how quickly a payment lands on the board |
| `NEXT_PUBLIC_SITE_URL` | Optional | Absolute return URLs when no Origin header exists |

## Running the night

1. Open `/` on the projector laptop and press **F** for full screen.
2. Set the line-up, goal, track, lap length and laps in **Controls** (**M**).
3. The room scans the QR code and backs snails from their phones between races.
4. **Space** starts the race. Betting closes, the countdown runs, drama ensues - and
   with a longer race set, keeps ensuing.
5. The winner card names the snail's backers; fun-bet chips pay out at locked odds.
6. At the end: export the CSV, print the report, and reconcile against Stripe's
   dashboard plus the cash tin. Save a backup JSON if the night continues next week.

Keyboard: **Space** or **PageDown** start, **Esc** or **PageUp** reset/close, **M**
controls, **C** calm mode (stops decorative motion), **S** sound, **B** music and crowd,
**V** the spoken caller, **F** full screen.

## Deployment

Two shapes from one codebase.

- **Server** (Vercel, Node, anything running `next start`): the whole app, Stripe API
  routes included.
- **GitHub Pages**: a static export of the game. Pages cannot run server code, so the
  deploy workflow removes `app/api` before building and the stage runs cash-and-chips
  only, saying so on screen. The build sets `NEXT_PUBLIC_STATIC_EXPORT`, which stops the
  client calling `/api/...` at all. Without it the donation poll and the payment-link
  fetch hit those paths every few seconds from a host that does not have them, and on a
  project Pages site those paths are not even the same site.

The Pages workflow deploys on every push to `main` and then **fetches the published URL
and fails the job if the site is not serving the game**, so an inactive site shows up as
a red build instead of a silent one. It never cancels a deployment that is already
running, because cancelling one mid-flight is what leaves the `github-pages` environment
showing an inactive deployment with nothing behind it.

## Architecture notes

- Next.js App Router, TypeScript strict, Tailwind v4. No database: Stripe holds the
  card ledger, `localStorage` holds the night's local state (line-up, cash, results,
  chips), and the QR code itself carries the race line-up to donor phones.
- The race loop owns the physics and hands each frame to a **painter**; `RaceTrack`
  draws straight lanes and `Circuit` draws laps of a course. Both are given the same `p`
  per snail and differ only in where they put it, which is why laps and a moving camera
  could be added without reopening the fairness argument. Positions are written straight
  to the DOM; React renders everything a human reads (status, commentary, results).
- All motion respects `prefers-reduced-motion`, and the moderator has a calm toggle.
- `legacy/` holds the previous zero-dependency single-file build, which still works
  offline from `file://` if a venue has no internet at all.
