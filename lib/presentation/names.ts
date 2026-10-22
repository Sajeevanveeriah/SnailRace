/**
 * How a snail's name and owner fit a projector card.
 *
 * The cards on the racecard and the thank you are a grid of equal boxes:
 * the art has a fixed height for the whole grid and the name sits in a box
 * of a fixed number of lines, so a long name steps down a size instead of
 * taking the art's room. The wrapping is estimated here, in projector units
 * (var(--u)), from the words and an average glyph width, so the same card is
 * laid out the same at 720p, 1080p and 4K and the estimate is unit-tested.
 * The estimate errs wide: a name that the browser can set on two lines may
 * be reserved three, never the other way round.
 */

/*
 * Advance widths of the projector's bold sans (weight 900, the widest the
 * cards use), in thousandths of an em, measured in the browser. A system font
 * stack sets the cards, so another machine's face may run a little wider:
 * the card rows grow rather than clip if it does, so SAFETY only covers
 * rounding (see show-screens.css).
 */
const GLYPH_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~·éü’';
const GLYPH_WIDTHS = [199,381,625,662,666,1044,695,372,388,388,608,693,373,475,373,412,711,452,646,669,702,666,675,612,679,675,373,378,693,693,693,601,1059,808,668,748,723,613,584,754,750,291,596,759,565,956,770,775,656,787,668,666,687,722,808,1100,786,775,694,388,368,388,500,493,401,597,646,603,646,606,382,647,649,296,296,606,296,943,649,625,646,646,434,588,360,649,632,877,609,636,590,505,405,505,693,373,606,649,353];
const GLYPH = new Map(Array.from(GLYPH_CHARS).map((ch, i) => [ch, GLYPH_WIDTHS[i] / 1000]));
const SAFETY = 1.01;
/** Anything outside the table (accents, other scripts) is taken as a wide capital. */
const glyphEm = (ch: string): number => GLYPH.get(ch) ?? 0.78;
/** The set width of `text`, in em. */
export const textEm = (text: string): number => Array.from(text).reduce((w, ch) => w + glyphEm(ch), 0) * SAFETY;

/** Line height the cards use for names and owners. */
export const NAME_LINE = 1.08;

export interface NameSizeStep {
  /** CSS class on the name box: '' for the base size. */
  className: string;
  /** Font size in projector units. */
  size: number;
}

/** Greedy word wrap: how many lines `text` needs when a line holds `lineEm` em. Words never break; a word wider than a line takes one line of its own. */
export function wrappedLines(text: string, lineEm: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const space = textEm(' ');
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const w = textEm(word);
    if (used === 0) {
      used = w;
    } else if (used + space + w <= lineEm) {
      used += space + w;
    } else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/** The longest word, in characters. */
export const longestWord = (text: string): number => Math.max(0, ...text.trim().split(/\s+/).map((w) => w.length));

/** The widest word, in em. */
export const widestWordEm = (text: string): number => Math.max(0, ...text.trim().split(/\s+/).map(textEm));

/** The em a line of `widthU` holds at `sizeU`. */
export const lineEm = (widthU: number, sizeU: number): number => widthU / sizeU;

export interface NameFit {
  /** The step the name takes. */
  step: NameSizeStep;
  /** Lines the name needs at that step. */
  lines: number;
  /** A single word wider than the box even at the smallest step: let it break mid-word rather than clip. */
  breakWord: boolean;
}

/**
 * The largest step at which the name fits in `maxLines`; failing that, the
 * smallest step and however many lines it then needs.
 */
export function fitName(name: string, widthU: number, steps: readonly NameSizeStep[], maxLines = 2): NameFit {
  const text = name.trim() || ' ';
  let last: NameFit | null = null;
  for (const step of steps) {
    const em = lineEm(widthU, step.size);
    const lines = wrappedLines(text, em);
    last = { step, lines, breakWord: widestWordEm(text) > em };
    if (lines <= maxLines && !last.breakWord) return last;
  }
  return last as NameFit;
}

export interface FieldFit {
  /** Per lane: the class for the name box. */
  nameClass: string[];
  /** Per lane: the class for the owner line. */
  ownerClass: string[];
  /** Height of the name box in projector units, the same for every card in the grid. */
  nameBoxU: number;
  /** Height of the owner box in projector units, the same for every card in the grid. */
  ownerBoxU: number;
  /** Height of the label row (the thank you's race title) in projector units, the same for every card. */
  labelBoxU: number;
}

/** Uppercase labels are set wider and letter-spaced. */
const LABEL_SIZE = 1.6;
const LABEL_LINE = 1.15;
const LABEL_WIDEN = 1.3;

/** The inner width of a card, in projector units, for a grid of `cols` across the body. */
export function cardInnerWidthU(cols: number, { bodyPadU = 6, gapU = 1.1, cardPadU = 1.4, fixedU = 0 }: { bodyPadU?: number; gapU?: number; cardPadU?: number; fixedU?: number } = {}): number {
  if (fixedU > 0) return fixedU - cardPadU;
  return (100 - bodyPadU - gapU * (cols - 1)) / cols - cardPadU;
}

const NAME_STEPS: Record<'wide' | 'narrow', NameSizeStep[]> = {
  wide: [
    { className: '', size: 2.15 },
    { className: 'ss-long', size: 1.85 },
    { className: 'ss-xlong', size: 1.6 },
  ],
  narrow: [
    { className: '', size: 1.95 },
    { className: 'ss-long', size: 1.7 },
    { className: 'ss-xlong', size: 1.6 },
  ],
};
const OWNER_STEPS: NameSizeStep[] = [{ className: '', size: 1.6 }];
/** Extra height under a name or owner box so the last line's descenders are never clipped. */
const DESCENDER_U = 0.35;

export const nameSteps = (cols: number): NameSizeStep[] => (cols >= 6 ? NAME_STEPS.narrow : NAME_STEPS.wide);

/**
 * Lay out one grid of cards: every name gets its size step and every card
 * the same name and owner box heights, sized for the longest in the field.
 */
export function fitField(names: readonly string[], owners: readonly string[], cols: number, widthU: number, labels: readonly string[] = []): FieldFit {
  const steps = nameSteps(cols);
  const fits = names.map((n) => fitName(n, widthU, steps));
  const ownerFits = owners.map((o) => fitName(o || ' ', widthU, OWNER_STEPS));
  const nameLines = Math.max(2, ...fits.map((f) => f.lines));
  const ownerLines = Math.max(1, ...ownerFits.map((f) => f.lines));
  const labelLines = labels.length ? Math.max(1, ...labels.map((l) => wrappedLines(l.toUpperCase(), lineEm(widthU, LABEL_SIZE) / LABEL_WIDEN))) : 0;
  /* Two lines of the base size always fit; a third line only ever comes at the smallest step. */
  const nameBoxU = nameLines <= 2 ? 2 * steps[0].size * NAME_LINE : nameLines * steps[steps.length - 1].size * NAME_LINE;
  return {
    nameClass: fits.map((f) => [f.step.className, f.breakWord ? 'ss-break' : ''].filter(Boolean).join(' ')),
    ownerClass: ownerFits.map((f) => (f.breakWord ? 'ss-break' : '')),
    /* Plus room for the descenders of the last line ("Geelong" must not lose its g). */
    nameBoxU: Math.round((nameBoxU + DESCENDER_U) * 100) / 100,
    ownerBoxU: Math.round((ownerLines * OWNER_STEPS[0].size * NAME_LINE + DESCENDER_U) * 100) / 100,
    labelBoxU: Math.round(labelLines * LABEL_SIZE * LABEL_LINE * 100) / 100,
  };
}

/** The name an unnamed snail wears: "Snail 7". */
export const isDefaultName = (name: string, snailNo: number): boolean => name.trim() === `Snail ${snailNo}`;

/**
 * The line under a name on the winner and result cards. A named snail adds
 * its number ("Snail 7 · owned by Mel"); an unnamed snail is already called
 * "Snail 7", so only its owner follows, and nothing at all when it has none.
 */
export function numberLine(name: string, snailNo: number, owner: string, ownerPrefix = ''): string {
  const who = owner.trim();
  if (isDefaultName(name, snailNo)) return who ? `${ownerPrefix}${who}` : '';
  return `Snail ${snailNo}${who ? ` · ${ownerPrefix}${who}` : ''}`;
}

/** The thank you card line: the number for a named snail, never "Snail 2" twice. */
export function winnerOwnerLine(name: string, snailNo: number, owner: string): string {
  const who = owner.trim();
  return isDefaultName(name, snailNo) ? who : `No. ${snailNo}${who ? ` · ${who}` : ''}`;
}

/**
 * The words of a name, marking those that must never break: a word with a
 * hyphen wraps as one piece ("Slimes-a-Lot" never ends a line at "a-").
 */
export function nameWords(name: string): { text: string; nobreak: boolean }[] {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text, nobreak: /\p{L}-\p{L}/u.test(text) }));
}
