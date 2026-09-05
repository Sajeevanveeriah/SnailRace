/** Generated English narration: HeyGen public voice Dynamic Derek, 2026-09-05.
 * Bundled clips require no runtime API key. Runner names remain in live captions. */
export const RECORDED_CUES = {
  "start": "And they are away!",
  "early": "The field is settling into the race.",
  "lead": "There's a change at the front!",
  "overtake": "That's a tidy move through the field.",
  "close": "It's close at the front. This could go either way.",
  "clear": "The leader has opened up a gap.",
  "mid": "Still plenty of racing left.",
  "final": "Here they come, heading for the finish!",
  "photo": "This is going right to the line!",
  "winner": "What a finish! We have our winner.",
  "lap": "Another lap completed.",
  "bell": "That's the bell. One lap to go!",
  "lettuce": "There's lettuce on the track! Someone's stopped for a snack.",
  "plague": "Here comes the plague cloud. That's trouble for the field!",
  "ball": "Watch out! There's a cricket ball rolling across the course.",
  "sprinkler": "The sprinklers have come on! It's getting slippery out there.",
  "roller": "Here comes the pitch roller. Mind the gap!",
  "dog": "There's a dog on the track! That's caused a stir.",
  "magpie": "A magpie is swooping over the runners!",
  "boot": "The groundskeeper has wandered onto the course!",
  "bee": "There's a bee buzzing around the field!",
  "boost": "That's a useful burst of pace!",
  "delay": "Oh, that's cost some ground.",
  "retire": "That's the end of the race for one of our runners.",
  "warning": "Keep an eye on the course. Something's about to happen.",
  "reaction": "Well, that changes things!",
  "ready": "The field is ready. Let's get this race started.",
  "void": "The race has been stopped. We'll get everyone ready to go again."
} as const;
export type RecordedCue = keyof typeof RECORDED_CUES;

/** Only match specific supported events; never invent a race fact. */
export function recordedCueFor(text: string): RecordedCue | undefined {
 const value = text.toLowerCase();
 const rules: Array<[RegExp, RecordedCue]> = [
 [/race.*(?:void|stopped|declared)/, 'void'], [/\bwins?\b|we have.*winner/, 'winner'],
 [/away/, 'start'], [/lettuce/, 'lettuce'], [/plague/, 'plague'],
 [/cricket ball/, 'ball'], [/sprinkler/, 'sprinkler'], [/pitch roller/, 'roller'],
 [/dog.*track/, 'dog'], [/magpie|swoop/, 'magpie'], [/groundskeeper/, 'boot'],
 [/boundary bee/, 'bee'], [/retir/, 'retire'], [/bell|last lap|final lap/, 'bell'],
 [/lap/, 'lap'], [/photo|on the line|right to the line/, 'photo'],
 [/hits the front|takes the lead|new leader|into the lead/, 'lead'],
 [/past|overtak|up to.*place/, 'overtake'], [/ready/, 'ready']
 ];
 return rules.find(([pattern]) => pattern.test(value))?.[1];
}
