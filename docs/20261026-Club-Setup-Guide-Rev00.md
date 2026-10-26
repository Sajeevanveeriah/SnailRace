# Setting up the Snail Race for a new club

One codebase runs every club's night. Everything that belongs to one club (its
name, crest, colours, sponsors, poster, event defaults and, if it has one, the
card it has already sold) lives in one folder, `clubs/<id>/`. Nothing else in
the app names a club.

A build is always for exactly one club. The build copies that club's assets,
and only that club's, into the site, so a build for one club never carries
another club's names, logos or roster.

## What is in a club folder

```
clubs/<id>/
  club.ts          the profile (see clubs/types.ts for every field)
  assets/          crest, poster, share image, sponsors/ logos
```

`clubs/ndcc/` is a full example: crest, poster, sixteen sponsor logos and the
sold card of 24 October 2026. `clubs/template/` is the bare minimum: a
placeholder crest and no sponsors.

## Steps

1. **Make the folder.**

   ```
   npm run club -- new hightonfc "Highton Football Club" "HFC"
   ```

   This copies `clubs/template` to `clubs/hightonfc` with the name filled in.

2. **Crest.** Put the club's crest in `clubs/hightonfc/assets/` (PNG with a
   transparent background, or SVG). Set `crest.file` to its name and
   `crest.width` / `crest.height` to its pixel size. Use the club's supplied
   file; do not redraw it.

3. **Colours.** `colours.primary` fills the bars, buttons and the date band;
   `colours.accent` edges and highlights; `colours.highlight` (optional) the
   price band. Use the club's approved colours as `#rrggbb`.

4. **Sponsors.** Put each logo in `assets/sponsors/` (WebP or PNG, about
   600 px wide) and list it under `sponsors` as `{ name, file }`. They roll
   beside each winner and sit on the fence boards. A club with no sponsors
   leaves the list empty and the reel does not show.

5. **Event defaults.** `event` sets what a fresh night is called, the date,
   start time, venue, time zone, the goal on the goal ring and the page
   description. Every one of these can still be changed on the night in
   Admin.

6. **The commentator's place.** `place` is the town or ground the commentary
   names ("Only at Highton!").

7. **Club teams (optional).** `clubTeamPatterns` are regular expressions for
   sponsor names that are the club's own teams. A race sponsored by one
   shows the crest alone instead of looking for a sponsor logo.

8. **Poster (optional).** `poster` is the lobby art and `shareImage` the
   picture shown when the link is shared. 900 x 1125 suits both. If the
   poster has its own title and date baked in, `posterFocus` zooms and shifts
   it so only the artwork shows (NDCC uses `{ zoom: 3, shiftY: -54.4 }`).
   Without a poster the crest stands in.

9. **Sold card (optional).** If the club has already sold snails, `night`
   holds the roster (`[number, snail name, owner]`), the races sold to
   sponsors and a run sheet with one row per race. A fresh night then starts
   from that card and Admin, Setup gets a button to load it again. Never put
   email addresses or phone numbers in the roster; the tests reject them.

10. **Check it.**

    ```
    CLUB=hightonfc npm run dev        open http://localhost:3000
    npm test                          includes a check of every club folder
    ```

11. **Ship it.** Give each club its own site:

    ```
    CLUB=hightonfc WORKER_NAME=hightonfc-snailrace bash scripts/deploy-cloudflare.sh
    ```

    That is the static, cash-only build on Cloudflare Workers. For card
    donations the club needs the server build (`CLUB=hightonfc npm run build`
    then `npm start`, or Vercel with `CLUB` set) and its own Stripe keys, so
    donations go straight to the club's account.

## What stays the same for every club

The race engine, the sealed draw and audit chain, the run sheet, the circuits
and surprises, Phone Play, the cash tote, the quaddie and the moderator desk.
Internal storage keys and audit tags still start with `ndcc-`; they are never
shown, and changing them would break saved nights and published audit hashes.
