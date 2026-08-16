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
stand down, and the telecast takes the whole screen with broadcast graphics over
the top: the clock and the live shot along the top, the running order bottom left
and the call along the bottom. The moderator's own buttons fade out with them and
come back on hover or on focus, so nothing sits over the race while the keyboard
still drives the night from the back of the room.

Measured on a 1080p screen, the race went from **47 percent of it to 100**.
Checked at 1280x800, 1366x768, 1920x1080 and 3840x2160: fills the screen at
every one, with no horizontal overflow.

The type scales with the screen rather than staying at laptop sizes, so the
commentary, the lap and the surprise banners are readable from the back.

## The telecast

The race is drawn the way athletics is shot for television: **one camera on the
infield, running along the track with the field**. Lanes are horizontal bars,
every snail holds one for the whole race, and the surface streams past behind
them - which is what makes a slow race look fast. Straight lanes are still there
as a **Track** option in **Controls**, and read better on a poor projector.

The view this replaced was top-down. From above, a snail on the far bend is
upside down, lanes cross the screen at every angle, and a tight shot frames two
runners and a lot of empty dirt. From the side there is no bend to be on, nothing
to be upside down, and the camera has one axis to worry about instead of two.

Laps are what make a race long without making it dull: a lap length times a lap count,
set separately, so the default **45 seconds a lap over 3 laps** is a 2m 15s race and
60 x 9 is a nine-minute epic. Laps run as one continuous straight with a **LAP 2**
gantry at each crossing rather than a jump back to the start, so the camera never
cuts backwards. Each lap gets a call and the last one gets **the bell**.

**Pace matters more than it looks.** A lap is 4,000 world units and a snail is
roughly 170 of them long, so 45 seconds a lap is about half a body-length a
second - which is what an actual snail does. A 12-second lap is four times that
and reads as a sprinting animal. The console prints the resulting race length and
pace next to the setting, so it is never a surprise on the night.

### The camera

Deliberately dull. A director cutting every two seconds between tight close-ups is a
director nobody can follow, so this one has three framings, each held for the better
part of ten seconds, and **every change is eased rather than cut**:

| Shot | What it frames |
|---|---|
| `TRACKING` | The whole field, always. The default. |
| `LEAD GROUP` | The front four, a shade tighter |
| `LOW ANGLE` | The field again, closer in |
| `FINISH LINE` | Taken at the run home and kept, with the line at the right of frame |

The zoom is always chosen to *contain* the runners rather than to find a dramatic
close-up, so nobody ever loses their snail off the edge of the screen. Turn the
director off in **Controls** to hold the whole race in one frame.

**The frame fits the screen, not the other way round.** The picture is authored
16:9, but a projector, a laptop and a hall's pull-down screen are not. Rather than
crop a fixed frame - which is what put the outside lanes and the strap off the
bottom - the visible window is fitted to the container's shape and anchored to the
bottom, and the ground, sky and lanes are drawn well past the authored edges so a
wide screen simply sees more track. Checked at 1366x768, 1920x1080 and 2560x720:
every lane visible, nothing under the graphics.

### The graphics

Everything a broadcast puts on screen, and none of it over the runners:

- **Top bar:** a LIVE badge, the club and race number, the lap, the race clock and
  the shot that is live.
- **Running order**, bottom left, six deep, with lane colours and gaps in seconds
  behind the leader. Quoted against the race's own pace, not the leader's rate on the
  frame, which used to pin every gap to the clamp and read "+99.0s" for the whole field.
- **The strap** along the bottom carries the call, at a size that reads from the back
  of a hall.
- A surprise gets a **lower third** on the right, not a card across the middle of the
  track.

Name supers sit above each snail. Because the lanes are separated vertically, two
runners level with each other can never print over one another - which they did
constantly on the old top-down course. Past a dozen lanes a band is thinner than a
line of type, so only the runners in contention and anyone a surprise has just
landed on are named, and the running order carries the rest. The effect flag is
parked using the name's measured width rather than a guess from its character
count.

### How it is drawn

Three depths of parallax behind the track - a floodlit grandstand with a crowd in
it, advertising hoardings carrying the club name, and grass - plus an out-of-focus
bank across the front. Cross-marks painted every hundred units are what carry the
speed. The near kerb stops well short of the bottom of frame so the graphics never
sit on a lane.

The snails are drawn side-on, the way you would actually see one pass: a wet trail
behind, a contact shadow, the soft foot, the shell with its spiral and a highlight,
then a head on a neck with two eye stalks. They glide on a wave down the foot and
cast their stalks about as they go. Runners are drawn far side first, so a snail
in a near lane passing one on the far side occludes it.

### Surprises

Twenty-two of them, weighted so the ordinary ones carry the race and the strange
ones are worth waiting for. Turbo slime, a second wind, a slipstream tow and a
triple espresso on the good side; shell slips, micro-naps, cramp, stage fright, a
lettuce break and a wrong turn on the bad. Then a third tone, **wild**, whose
magnitude is drawn either side of zero - mystery slime, a banana peel, snail
romance, a trip upstairs to the third umpire - so nobody, the caller included,
knows which way it went until it lands.

**Field events** hit several lanes at once and are the ones the room talks about
afterwards: a shell plague sweeping the field, a magpie swoop, the sprinklers
coming on, hail, the club dog loose on the track, a lettuce thrown over the fence,
a false-start panic, a streaker. One roughly every forty-five seconds. They get one
loud call rather than six small ones, a wide card, and a knock of the camera.

Every surprise has its own sound - a nap does not sound like a cramp, and a magpie
does not sound like either - so a punter at the bar with their back to the screen
knows what just happened.

Mechanically a field event is nothing new: one ordinary per-lane event sharing a
start, a label and a group id. Every bump still rides an envelope that is exactly
zero at the line, so **the fairness argument does not move**. Verified over 4,000
races across fields of 3 to 20: zero order mismatches, zero early finishes, zero
reversals, and the winner uniform to within 0.13 points of 1/N over 120,000 draws
per field size.

### Also on the track

- **Weather**, drawn from the seed: clear, drizzle or a downpour, with the commentary
  calling it. Scenery only - it never touches a position.
- Fields from 3 to 20 all fit. Lane bands taper towards the far side and are
  normalised to the same width of screen at any field size, and a snail may stand
  taller than its own band because the draw order makes the overlap read as depth.

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
line they no longer have time for. A big line will only cut into one that has
had time to become a sentence - interrupting the instant a line started
produced half-words and a caller that sounded like a radio being retuned.
Everything the room reads is everything the room hears; the two can never
drift apart because they go through one function.

The caller also reacts. A beat after a surprise it says something about it -
"oh, that is heartbreaking", "the stewards are going to have a look at that one" -
before going back to the running order, and the run of play is chosen from what it
can actually see: the top two locked together get a different line from a leader
eight lengths clear, and the snail at the back gets the occasional joke at its
expense.

It is read at a **level rate and pitch**, a shade quicker on the big moments and
no more. Past about 1.1 a synthetic voice stops sounding urgent and starts
sounding wrong, which is exactly what an earlier version at 1.22 and a tone
higher did.

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
  draws straight lanes and `Telecast` draws the trackside broadcast. Both are given the
  same `p` per snail and differ only in where they put it, which is why laps and a moving
  camera could be added without reopening the fairness argument. Positions are written straight
  to the DOM; React renders everything a human reads (status, commentary, results).
- All motion respects `prefers-reduced-motion`, and the moderator has a calm toggle.
- `legacy/` holds the previous zero-dependency single-file build, which still works
  offline from `file://` if a venue has no internet at all.
