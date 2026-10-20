/**
 * The race-call script. Recorded 2026-10-20 with Resemble AI Chatterbox
 * (Hugging Face space ResembleAI/Chatterbox), voice-cloned from the previous
 * caller so the sound of the room did not change overnight. Bundled clips
 * require no runtime API key.
 *
 * Three takes per cue, same meaning, different words, so a night of racing
 * does not repeat itself. Take 1 is `<cue>.mp3`, then `<cue>-2.mp3` and
 * `<cue>-3.mp3`. The player picks a take at random and never plays the same
 * take twice running - see `audio/voice.ts`.
 *
 * The clips never name a snail. The caption on the rail carries the number
 * and the name, so the picture and the voice always agree: "Snail 7 hits the
 * front" on screen, "And there's a new leader!" out of the speaker.
 *
 * Regenerate with `node scripts/generate-commentary.mjs` (needs the
 * Chatterbox endpoint; see `public/audio/README.md`).
 */
export const RECORDED_CUES = {
  ready: [
    "Righto, they're all loaded up. Let's get this one going!",
    "Field's in, gates are set. Stand by, here we go!",
    "All in and ready. Hold onto your hats, this one's about to go!",
  ],
  start: [
    "And they're away! Good jump from the inside, and they're racing!",
    "They're off! Clean start right across the field!",
    "And they're racing! Away cleanly, and they're all up on the shell!",
  ],
  early: [
    "They're settling down now, finding their spots early.",
    "Early days yet. The field's sorting itself out.",
    "Nice and steady through the first bit, nobody's panicking.",
  ],
  quarter: [
    "A quarter gone and they're bunching up nicely!",
    "Quarter of the way and they're all in a heap!",
    "A quarter done. Tight at the front, and the back's not far off!",
  ],
  half: [
    "Halfway! And there's nothing in it up the front!",
    "They're at the half and it's on! Still anyone's race!",
    "Halfway home and they're bunching up at the two!",
  ],
  threeQuarter: [
    "Three quarters gone! They're coming to the turn and it's tightening up!",
    "Into the last quarter and they're stacking up behind the leader!",
    "Three quarters of the way! Get ready, this is where it gets going!",
  ],
  mid: [
    "Still a long way to go in this one.",
    "Plenty of racing left yet. Nobody's won it from here.",
    "Long way to go. Hold your breath, this one's not done.",
  ],
  lead: [
    "And there's a new leader! Hits the front!",
    "Change of lead! Up and around them, and takes it up!",
    "Oh, look at that! Comes through and grabs the lead!",
  ],
  overtake: [
    "There's a move! Up past one and into the clear!",
    "Goes past! Nice bit of work through the pack!",
    "And one slips through on the inside! Picks up a spot!",
  ],
  close: [
    "Nothing in it! You could throw a blanket over the lot of them!",
    "Tight up the front! Side by side, neither of them giving an inch!",
    "Locked together! There's a nose in it, if that!",
  ],
  clear: [
    "The leader's got away! That's a couple of lengths now!",
    "Opened up a gap! The rest are going to have to chase!",
    "Out in front on its own! Daylight to the rest of them!",
  ],
  final: [
    "Here they come down the straight! They're coming home!",
    "Into the straight now! Get up! Get up! Come on!",
    "Down the straight they come! Hang on, this is going to be close!",
  ],
  photo: [
    "It's a photo! Too close to call! Oh, that's tight!",
    "Right to the line! Nothing in it! That's a photo!",
    "Two together on the line! Photo finish! Who got it?",
  ],
  winner: [
    "And it's over the line! What a finish! We've got a winner!",
    "Get up! Get up! And it's over the line! That's the race!",
    "Over the line! Oh, what a race! There's your winner!",
  ],
  lap: [
    "And round they go, another lap down!",
    "Across the line and into the next lap! Still racing!",
    "That's a lap done. Plenty more to come!",
  ],
  bell: [
    "There's the bell! Last lap! Here we go!",
    "The bell's gone! One to go, and it's on!",
    "Bell lap! One more time around! Come on!",
  ],
  lettuce: [
    "Lettuce on the track! Someone's stopped for a feed!",
    "Oh no, there's a lettuce! That's got their attention!",
    "Somebody's thrown a lettuce out there! That's going to cause trouble!",
  ],
  plague: [
    "Plague's through the field! They're dropping everywhere!",
    "Oh, there's a plague on! Half of them have gone down!",
    "The plague's hit! That's a disaster for the middle of the pack!",
  ],
  ball: [
    "Cricket ball! Rolling straight through the field! Look out!",
    "Oh, look out! A ball's come across the course!",
    "There's a cricket ball on the track! That'll scatter them!",
  ],
  sprinkler: [
    "Sprinklers are on! It's gone slippery out there!",
    "Oh, the sprinklers! The whole straight's under water!",
    "Sprinklers have come on! They're sliding everywhere!",
  ],
  roller: [
    "The pitch roller's coming through! Mind the gap!",
    "Look out, here's the roller! Get out of the way!",
    "Roller on the course! Everyone's diving for cover!",
  ],
  dog: [
    "Dog on the track! That's caused a stir!",
    "Oh, there's a dog loose! Absolute chaos!",
    "Someone grab that dog! It's gone straight through them!",
  ],
  magpie: [
    "Magpie! Swooping through the middle of them!",
    "Look out! Magpie coming in low!",
    "There's a magpie on them! They're ducking for cover!",
  ],
  boot: [
    "The groundsman's wandered onto the course! Watch your feet!",
    "Oh, there's a boot! The groundskeeper's walked straight through them!",
    "Groundskeeper's on the track! Mind the big boots!",
  ],
  bee: [
    "There's a bee about! That's got them twitchy!",
    "Bee on the track! Look at them scatter!",
    "Oh, a bee's got in amongst them!",
  ],
  boost: [
    "Oh, look at that! Found another gear!",
    "That's a burst of speed! Where did that come from?",
    "Sprouted wings! That's a real turn of pace!",
  ],
  delay: [
    "Oh, that's cost some ground!",
    "That's a stumble! Lost a couple of lengths there!",
    "Oh no, that's gone backwards! That'll hurt!",
  ],
  retire: [
    "And that's one out of the race! That's the end of it!",
    "Oh, that one's done! Pulled up! Out of the race!",
    "That's a retirement! Won't be finishing, that one!",
  ],
  warning: [
    "Hang on, something's coming! Keep an eye out!",
    "Oh, hello, what's this? Something's about to happen!",
    "Watch this! There's something on its way!",
  ],
  reaction: [
    "Well, that's changed things!",
    "Oh, that's turned it right on its head!",
    "Did you see that? That changes everything!",
  ],
  void: [
    "Hold on, that race is off. We'll get them back and go again.",
    "Race is stopped. Stewards have called it. We'll re-run it.",
    "That one's void, folks. Back to the barriers, we'll go again.",
  ],
} as const;
export type RecordedCue = keyof typeof RECORDED_CUES;

export const TAKES_PER_CUE = 3;

/**
 * How much the caller leans into each cue when the clips are generated.
 * Chatterbox "exaggeration": about 0.7 for the early race, 0.9 for a twist,
 * 1.1 for the straight and the finish, so the energy rises towards the line.
 */
export const CUE_ENERGY: Record<RecordedCue, number> = {
  ready: 0.6, start: 0.7, early: 0.7, quarter: 0.75, half: 0.8, threeQuarter: 0.9, mid: 0.7,
  lead: 0.9, overtake: 0.8, close: 0.85, clear: 0.8,
  final: 1.1, photo: 1.1, winner: 1.1,
  lap: 0.8, bell: 0.9,
  lettuce: 0.9, plague: 0.9, ball: 0.9, sprinkler: 0.9, roller: 0.9, dog: 0.9, magpie: 0.9, boot: 0.9, bee: 0.9,
  boost: 0.9, delay: 0.85, retire: 0.85, warning: 0.85, reaction: 0.9, void: 0.6,
};

/**
 * How many takes of the new script have actually been recorded for each cue.
 * Written by `scripts/generate-commentary.mjs` after a run; do not edit by hand.
 *
 * The 2026-10-20 run hit the Chatterbox space's daily GPU quota after seven
 * clips. A cue on 0 still plays `<cue>.mp3`, which is the previous caller's
 * single-take clip from 2026-09-05 (same meaning, older wording). `quarter`,
 * `half` and `threeQuarter` are copies of that caller's "still plenty of
 * racing left" line until they are recorded. Re-run the script to fill in.
 */
export const RECORDED_TAKES: Record<RecordedCue, number> = {
  ready: 3, start: 3, early: 1, quarter: 0, half: 0, threeQuarter: 0, mid: 0,
  lead: 0, overtake: 0, close: 0, clear: 0, final: 0, photo: 0, winner: 0, lap: 0, bell: 0,
  lettuce: 0, plague: 0, ball: 0, sprinkler: 0, roller: 0, dog: 0, magpie: 0, boot: 0, bee: 0,
  boost: 0, delay: 0, retire: 0, warning: 0, reaction: 0, void: 0,
};

/** Takes the player may choose from: at least the single legacy clip. */
export const takesFor = (cue: RecordedCue): number => Math.max(1, RECORDED_TAKES[cue] ?? 0);

/** File name of one take, relative to `public/audio/commentary/`. */
export const clipFile = (cue: RecordedCue, take: number): string =>
  take <= 1 ? `${cue}.mp3` : `${cue}-${take}.mp3`;

/**
 * Only match specific supported events; never invent a race fact.
 *
 * This is the fallback for a caption that arrives without an explicit cue.
 * Every pattern is anchored to a phrase the commentary book actually says.
 * A loose word used to misfire: "/away/" matched "{b} is a length away and
 * paying attention" and played "And they are away!" in the middle of a race,
 * and "/ready/" matched "already".
 */
export function recordedCueFor(text: string): RecordedCue | undefined {
  const value = text.toLowerCase();
  const rules: Array<[RegExp, RecordedCue]> = [
    [/race.*(?:void|stopped|declared)|has been stopped/, 'void'],
    [/\bwins?\b|we have.*winner|our winner/, 'winner'],
    [/they are away|they're away|and they are off|under way/, 'start'],
    [/lettuce/, 'lettuce'],
    [/plague/, 'plague'],
    [/cricket ball/, 'ball'],
    [/sprinkler/, 'sprinkler'],
    [/pitch roller/, 'roller'],
    [/\bdog\b/, 'dog'],
    [/magpie|swoop/, 'magpie'],
    [/groundskeeper|groundsman/, 'boot'],
    [/boundary bee|\bbee\b/, 'bee'],
    [/\bretir/, 'retire'],
    [/\bbell\b|last lap|final lap|one lap to run|one lap to go/, 'bell'],
    [/\blaps?\b/, 'lap'],
    [/hits the front|takes the lead|new leader|into the lead|lead change|change of lead|snatches it|takes it up/, 'lead'],
    [/goes past|up to .* place|been passed|takes .* off|overtak/, 'overtake'],
    [/photo finish|right to the line|on the line!/, 'photo'],
    [/to run and it is|inside the last|left, .* closing|turns for home|can see the line|needs every/, 'final'],
    [/quarter of the way|quarter gone/, 'quarter'],
    [/three-quarter|three quarter/, 'threeQuarter'],
    /* "halfway" stays on the generic mid clip here; the loop passes `half` explicitly. */
    [/halfway|looks settled|proper race of it|holds the front|for company|another gear/, 'mid'],
    [/tidy start|leads them out|has the rail|clean getaway|sets the pace|settling into/, 'early'],
    [/throw a blanket|side by side|locked together|in it between|neither giving|nothing in it|by a nose/, 'close'],
    [/broken the elastic|is gone\.|put on the field|reel in|clear!/, 'clear'],
    [/field is ready|get this race started|under starter/, 'ready'],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1];
}
