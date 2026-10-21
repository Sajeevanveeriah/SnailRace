# Your own audio (all optional)

The app ships recorded race calls in `commentary/`. The script (31 cues, three takes
each, written the way a club race caller talks) is in `lib/audio/voice-cues.ts`. The voice
is Resemble AI Chatterbox, cloned from the previous caller's clip so the sound of the room
did not change, encoded mono 24 kHz 64 kbps MP3 with leading and trailing silence
trimmed. No API key or speech service is called during a race.

Seven takes (`start` x3, `ready` x3, `early` x1) were recorded on 2026-10-20 on the public
Hugging Face space `ResembleAI/Chatterbox`, which then ran out of free GPU quota. The rest
were recorded on 2026-10-21 with the same model, the same settings and the same seeds,
run locally on CPU. `RECORDED_TAKES` in `voice-cues.ts` says exactly which takes exist.
`voice-reference.mp3` is the previous caller's original clip (2026-09-05, HeyGen
"Dynamic Derek"), kept aside as the voice every recording clones.

To re-record after changing a line, delete its clips, set its count in `RECORDED_TAKES`
back, and run one of:

    node --experimental-strip-types scripts/generate-commentary.mjs --local
    node --experimental-strip-types scripts/generate-commentary.mjs

`--local` runs the model on this machine (`pip install chatterbox-tts "setuptools<81"`,
CPU PyTorch is enough, about 15 seconds a take; `CHATTERBOX_PYTHON` picks the Python). The
plain form calls a Chatterbox Gradio endpoint (`CHATTERBOX_URL`, default the public space;
`HF_TOKEN` raises the quota) with a public URL for the reference voice
(`VOICE_PROMPT_URL`). Both need an `ffmpeg` with libmp3lame and record only the takes that
are missing. The hosted form stops after five failures in a row and keeps what it has. It
is deliberately not part of `npm run build` and cannot run in CI.

Natural race caller is the default. The clips never say a snail's number or name: the
caption on the rail carries those, so "Snail 7 hits the front" on screen is "And there's a
new leader!" out of the speaker. The player picks a random take and never the same take
twice running; the same cue is not repeated within 25 seconds (the finish excepted); the
music ducks for the length of the clip. There is no filler line between calls - the caller
speaks for the off, lead changes, overtakes, the quarter, half and three-quarter marks,
each surprise, the straight, a close finish and the winner. A device voice can be selected
in Controls to speak the captions, names and all. Only one line plays at a time; stale
calls are dropped and the finish cancels prior audio. The clips are generated speech, not
a live human commentator.

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

## What the built-in music is

The built-in race track is a 128 BPM race-night theme in A minor over a four-chord loop
(Am, F, C, G): a filtered sawtooth bass, a synthesised kick and snare, swung hats, off-beat
chord stabs and a written eight-bar lead, with a shared reverb and tempo-synced delay for
air. It is **adaptive**: it starts with kick and bass, adds hats and stabs as the field gets
going, the snare and the lead at halfway, and a shaker, tambourine and the lead an octave
up in the run home, so the room hears how far into the race it is. A supplied `race.mp3`
is a fixed loop and cannot do that. If you like that behaviour, leave `race.mp3` out and
supply only `lobby.mp3`.

The built-in lobby track is a warm 98 BPM groove - an electric-piano chord loop (Am7,
Fmaj7, Dm7, G7), a walking bass and brushed hats - with no lead line, so people can talk
over it. The winner sting is a short, bright major fanfare of about six seconds.

When the caller speaks, the music ducks to no lower than 40% and comes back once the
longest thing talking over it has finished; a short effect never cuts a commentary duck
short.

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
