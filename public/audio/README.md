# Your own audio (all optional)

The app includes 28 generated English commentary clips in `commentary/`. They use
HeyGen's public Dynamic Derek voice, generated on 2026-09-05. Text is documented in
`lib/audio/voice-cues.ts`. No API key or speech service is called during a race.

Natural race caller is the default. Clips describe actual race events while captions
identify the runners. A device voice can be selected in Controls to speak custom names.
Only one line plays at a time; stale calls are dropped and the finish cancels prior audio.
The clips are generated speech, not a live human commentator.

Music and effects are synthesised by `lib/audio/` unless replacement files are supplied.

If you would rather use real recordings, drop them in this folder and rebuild. Each file
found replaces its synthesised cue; anything missing falls back automatically, so you can
supply one file or all of them. The moderator console (**M** → Sound) lists which ones it
found.

| File | Replaces | Should be |
|---|---|---|
| `lobby.mp3` | The between-races groove | Loopable, quiet, no vocals - people are being talked over |
| `race.mp3` | The race track | Loopable and driving. Note: a file cannot follow the race the way the built-in track does |
| `winner.mp3` | The winner sting | One-shot, 4-8 seconds |
| `fanfare.mp3` | The finish fanfare | One-shot, 1-3 seconds |
| `horn.mp3` | The starting horn | One-shot, under 1 second |
| `crowd.mp3` | The crowd bed | Loopable room tone, 20+ seconds so the loop is not obvious |
| `cheer.mp3` | Crowd cheers | One-shot, 1-3 seconds |
| `gasp.mp3` | Crowd groans | One-shot, about 1 second |

`.mp3`, `.ogg` and `.wav` all work; the loader tries them in that order.

`manifest.json` in this folder is **generated** by `npm run build` (and `npm run dev`) from
whatever is actually here - you never edit it. It exists so the app only ever requests files
that are present, instead of probing for two dozen that are not and filling the console with
404s. The practical consequence: **after adding or removing a file here, rebuild.**

## One trade-off worth knowing

The built-in race track is **adaptive**: it adds a backbeat at the quarter, an arpeggio at
halfway and a tambourine in the run home, so the room hears how far into the race it is.
A supplied `race.mp3` is a fixed loop and cannot do that. If you like that behaviour, leave
`race.mp3` out and supply only `lobby.mp3`.

## Where to find freely licensed music

Use a source that states its licence clearly, and keep a note of it - a fundraiser is a
public performance, and a streamed one is a broadcast.

- **Free Music Archive** (freemusicarchive.org) - filter by CC0 or CC-BY
- **Incompetech** (incompetech.com) - CC-BY, credit the composer
- **Pixabay Music** and **Freesound** (freesound.org) - filter to CC0 for no-attribution use
- **OpenGameArt** (opengameart.org) - CC0 game music and effects

Public-domain (CC0) tracks need no credit. CC-BY tracks do: put the credit in the event
programme or on a slide. If your venue has a APRA AMCOS or PRS licence, commercial music is
covered there too - check with whoever books the venue.

Files in this folder are served as-is, so do not put anything here you are not licensed to
play in public.
