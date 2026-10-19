import { courseGeometry } from './course-geometry';

export type CourseId =
  | 'boundary-oval'
  | 'pavilion-chicane'
  | 'floodlight-eight'
  | 'practice-nets';

export interface RaceCourse {
  id: CourseId;
  name: string;
  shortName: string;
  description: string;
  /** A compact 120 x 72 course trace used by the live broadcast map. */
  mapPath: string;
  accent: string;
}

export const RACE_COURSES: readonly RaceCourse[] = [
  {
    id: 'boundary-oval',
    name: 'Boundary Oval',
    shortName: 'OVAL',
    description: 'A fast lap around the cricket boundary.',
    mapPath:
      courseGeometry('boundary-oval', 1)
        .centre.points.map((p, i) => `${i ? 'L' : 'M'}${p.x / 10},${p.y / 10}`)
        .join(' ') + ' Z',
    accent: '#e8b55e',
  },
  {
    id: 'pavilion-chicane',
    name: 'Pavilion Chicane',
    shortName: 'CHICANE',
    description: 'Two hard bends squeeze past the pavilion.',
    mapPath:
      courseGeometry('pavilion-chicane', 1)
        .centre.points.map((p, i) => `${i ? 'L' : 'M'}${p.x / 10},${p.y / 10}`)
        .join(' ') + ' Z',
    accent: '#6bd6c5',
  },
  {
    id: 'floodlight-eight',
    name: 'Floodlight Figure Eight',
    shortName: 'FIGURE 8',
    description: 'A crossover loop under the floodlights.',
    mapPath:
      courseGeometry('floodlight-eight', 1)
        .centre.points.map((p, i) => `${i ? 'L' : 'M'}${p.x / 10},${p.y / 10}`)
        .join(' ') + ' Z',
    accent: '#bd8cff',
  },
  {
    id: 'practice-nets',
    name: 'Practice Nets Switchback',
    shortName: 'SWITCHBACK',
    description: 'A tight zigzag through the practice nets.',
    mapPath:
      courseGeometry('practice-nets', 1)
        .centre.points.map((p, i) => `${i ? 'L' : 'M'}${p.x / 10},${p.y / 10}`)
        .join(' ') + ' Z',
    accent: '#f27d8c',
  },
] as const;

const COURSE_IDS = new Set<string>(RACE_COURSES.map((course) => course.id));

export function normaliseCourseId(value: string | null | undefined): CourseId {
  return value && COURSE_IDS.has(value) ? (value as CourseId) : 'boundary-oval';
}

export function courseById(value: string | null | undefined): RaceCourse {
  const id = normaliseCourseId(value);
  return RACE_COURSES.find((course) => course.id === id) ?? RACE_COURSES[0];
}

/**
 * The race card rotates through every authored course before repeating.
 * It depends only on the race number, so a held race and its replay always
 * show the same map, while consecutive races can never reuse one.
 */
export function courseForRace(raceNo: number): RaceCourse {
  const index = Math.max(0, Math.floor(raceNo) - 1) % RACE_COURSES.length;
  return RACE_COURSES[index];
}

/** A race view the operator can switch on: the side-on straight or one of the circuits. */
export type TrackDesignId = 'straight' | CourseId;

export const TRACK_DESIGNS: ReadonlyArray<{ id: TrackDesignId; name: string }> = [
  { id: 'straight', name: 'Side-on cartoon straight' },
  ...RACE_COURSES.map((course) => ({ id: course.id as TrackDesignId, name: `Top-down ${course.name}` })),
];

const DESIGN_IDS = new Set<string>(TRACK_DESIGNS.map((design) => design.id));

/** Keep the known designs, in display order, without repeats. Empty means "not chosen". */
export function normaliseTrackDesigns(value: unknown): TrackDesignId[] | null {
  if (!Array.isArray(value)) return null;
  const wanted = new Set(value.filter((x): x is string => typeof x === 'string' && DESIGN_IDS.has(x)));
  const list = TRACK_DESIGNS.map((design) => design.id).filter((id) => wanted.has(id));
  return list.length ? list : null;
}

/**
 * The designs switched on for the night. Before any are chosen the older
 * single setting stands: the straight, or every circuit in turn.
 */
export function enabledTrackDesigns(
  designs: readonly TrackDesignId[] | null | undefined,
  trackShape: 'lanes' | 'circuit',
): TrackDesignId[] {
  if (designs?.length) return [...designs];
  return trackShape === 'circuit' ? RACE_COURSES.map((course) => course.id) : ['straight'];
}

/**
 * The design a race runs on. The enabled designs take turns, race by race,
 * so a held race and its replay always show the same one. The straight keeps
 * the course id it always carried so its plan and hash are unchanged.
 */
export function designForRace(
  designs: readonly TrackDesignId[] | null | undefined,
  trackShape: 'lanes' | 'circuit',
  raceNo: number,
): { trackShape: 'lanes' | 'circuit'; courseId: CourseId } {
  if (!designs?.length) {
    return { trackShape, courseId: courseForRace(raceNo).id };
  }
  const index = Math.max(0, Math.floor(raceNo) - 1) % designs.length;
  const design = designs[index];
  return design === 'straight'
    ? { trackShape: 'lanes', courseId: courseForRace(raceNo).id }
    : { trackShape: 'circuit', courseId: design };
}
