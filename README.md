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

Backing a snail is a **donation with no return**, and the fun bets use **free play
chips with no cash payout** - which is what keeps the night a fundraiser rather than
a wagering product.

## Screens

| Route | Who it is for | What it does |
|---|---|---|
| `/` | The projector | Race stage, tote board, goal ring, donation ticker, QR code, fun-bet slip, moderator drawer |
| `/donate` | A punter's phone | Opened from the QR code. Pick a snail, pick an amount, pay through Stripe Checkout (Apple Pay / Google Pay) |
| `/donate/thanks` | The same phone | Confirms the paid amount and snail straight from Stripe |

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
2. Set the line-up, goal and race length in **Controls** (**M**).
3. The room scans the QR code and backs snails from their phones between races.
4. **Space** starts the race. Betting closes, the countdown runs, drama ensues.
5. The winner card names the snail's backers; fun-bet chips pay out at locked odds.
6. At the end: export the CSV, print the report, and reconcile against Stripe's
   dashboard plus the cash tin. Save a backup JSON if the night continues next week.

Keyboard: **Space** start, **Esc** reset/close, **M** controls, **C** calm mode
(stops decorative motion), **S** sound, **F** full screen.

## Architecture notes

- Next.js App Router, TypeScript strict, Tailwind v4. No database: Stripe holds the
  card ledger, `localStorage` holds the night's local state (line-up, cash, results,
  chips), and the QR code itself carries the race line-up to donor phones.
- The race loop writes positions as CSS custom properties directly to the lane
  elements; React renders everything a human reads (status, commentary, results).
- All motion respects `prefers-reduced-motion`, and the moderator has a calm toggle.
- `legacy/` holds the previous zero-dependency single-file build, which still works
  offline from `file://` if a venue has no internet at all.
