# Snail Race 4.1 - Broadcast Theatre release evidence

Date: 29 August 2026 (AEST)

## Outcome

This release turns the projector experience into an illustrated community-cricket
broadcast, makes the race caller less synthetic, reduces surprise fatigue, and adds
automated release gates for accessibility, responsive behaviour and production art.
The deterministic draw, finish times, zero-sum surprise envelopes, donation ledger and
free-fun-chip boundary are unchanged.

## Design fidelity ledger

| Approved direction | Production implementation | Evidence |
|---|---|---|
| Cricket oval at dusk | Authored 16:9 oval background within the telecast SVG and show screens | `public/art/snail-race-oval.webp`, `components/Telecast.tsx` |
| Illustrated snail cast | Six transparent, visually distinct runners mapped deterministically by lane | `public/art/snails/`, `components/Telecast.tsx` |
| Club broadcast palette | Maroon, chevron blue and warm gold; solid panels and clipped broadcast geometry | `app/broadcast-theatre.css` |
| Readable projector hierarchy | Top score bar, right standings, full-width commentary rail, surprise lower third | `components/Telecast.tsx`, `app/broadcast-theatre.css` |
| Cricket-ground surprises | Cricket ball, sprinkler, pitch roller, club dog, lettuce crate and magpie props | `public/art/surprises/`, `lib/race-engine.ts` |
| Human event voice | Dry, short, state-aware copy; deterministic wording stream; operator voice choice and preview | `lib/race-engine.ts`, `lib/show.ts`, `lib/audio/voice.ts` |

The art pack is approximately 3.8 MB, committed with the site and requires no paid
service, runtime generation, external asset host or venue network request.

## Behaviour and safety

- Commentary uses a separate RNG seeded from the race seed, so a replay tells the same
  story without consuming or changing the result stream.
- Standard surprise pace is about one authored beat per 7.5 seconds with a cap of 14.
  Whole-field moments are announced once even when several lanes are affected.
- Hidden stage content is inert and removed from the accessibility tree while a show
  screen is active; each show screen receives focus as it opens.
- All new decorative animation is disabled by `prefers-reduced-motion`.
- The historical Stripe metadata tag remains stable for reconciliation; only the client
  library app version changes to 4.1.0.

## Reproducible verification

Run from the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npx playwright install --with-deps chromium
npm run test:e2e
npm run build
```

Local verification on 29 August 2026:

| Gate | Result |
|---|---|
| TypeScript strict check | PASS |
| ESLint | PASS |
| Unit and invariant suite | PASS - 75/75 |
| Production server build | PASS |
| GitHub Pages static export | PASS - 79 files, API routes excluded and restored |

The pull-request workflow repeats those gates on Ubuntu and adds Chromium checks at a
1600x900 projector viewport and a Pixel 7 viewport. It also runs axe serious/critical
checks, 200 percent zoom overflow, reduced motion, focus isolation, production-art
presence and commentary-language assertions. Pages deploys only after the same quality
job passes on `main`, then performs a live HTTP/content check against the published URL.

## Cost boundary

The implementation uses repository assets, browser speech synthesis, WebAudio, GitHub
Actions and GitHub Pages. It adds no subscription, hosted database, external image API,
paid font, paid analytics, runtime AI call or billable deployment service. Stripe remains
optional server-mode donation infrastructure and no live payment was made as part of
this release.
