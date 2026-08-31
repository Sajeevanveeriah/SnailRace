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
    mapPath: 'M 18 36 C 18 12, 42 8, 60 8 C 88 8, 104 17, 104 36 C 104 57, 83 64, 60 64 C 35 64, 18 55, 18 36 Z',
    accent: '#e8b55e',
  },
  {
    id: 'pavilion-chicane',
    name: 'Pavilion Chicane',
    shortName: 'CHICANE',
    description: 'Two hard bends squeeze past the pavilion.',
    mapPath: 'M 12 56 C 27 63, 45 61, 48 47 C 52 28, 27 31, 31 15 C 35 1, 61 8, 69 20 C 78 34, 99 23, 109 12',
    accent: '#6bd6c5',
  },
  {
    id: 'floodlight-eight',
    name: 'Floodlight Figure Eight',
    shortName: 'FIGURE 8',
    description: 'A crossover loop under the floodlights.',
    mapPath: 'M 60 36 C 46 16, 34 10, 22 16 C 5 26, 13 53, 31 57 C 46 60, 51 47, 60 36 C 69 25, 75 12, 91 15 C 112 19, 113 49, 94 57 C 79 63, 68 51, 60 36 Z',
    accent: '#bd8cff',
  },
  {
    id: 'practice-nets',
    name: 'Practice Nets Switchback',
    shortName: 'SWITCHBACK',
    description: 'A tight zigzag through the practice nets.',
    mapPath: 'M 10 57 L 38 57 Q 49 57 49 46 L 49 40 Q 49 30 39 30 L 29 30 Q 18 30 18 19 Q 18 9 29 9 L 106 9',
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

/**
 * A subtle vertical camera cue for the live runners. It does not change race
 * progress or classification; it makes bends and crossovers visible in the
 * trackside shot while the map carries the exact course geometry.
 */
export function courseRide(id: CourseId, progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  if (id === 'pavilion-chicane') return Math.sin(p * Math.PI * 4) * 0.72;
  if (id === 'floodlight-eight') return Math.sin(p * Math.PI * 4) * 0.9;
  if (id === 'practice-nets') {
    if (p < 0.25) return -0.72;
    if (p < 0.5) return 0.55;
    if (p < 0.75) return -0.35;
    return 0.7;
  }
  return Math.sin(p * Math.PI * 2) * 0.2;
}
