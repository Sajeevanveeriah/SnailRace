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
