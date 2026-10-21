import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseGeometry, curvatures, kerbRuns, pointOnLane } from '../lib/course-geometry';
import { RACE_COURSES } from '../lib/courses';

for (const course of RACE_COURSES) {
  test(`${course.name}: 8 to 12 (and 20) runners stay on closed, bounded lanes`, () => {
    for (const count of [8, 9, 10, 11, 12, 20]) {
      const geometry = courseGeometry(course.id, count);
      for (const lane of geometry.lanes) {
        assert.deepEqual(pointOnLane(lane, 0), pointOnLane(lane, 1));
        assert.ok(lane.path.endsWith(' Z'));
        for (let j = 0; j < lane.points.length; j++) {
          const a = lane.points[j],
            b = lane.points[(j + 1) % lane.points.length],
            c = lane.points[(j + 2) % lane.points.length];
          assert.ok(
            (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0,
            'Lane must not fold back into a cusp',
          );
        }

        for (let i = 0; i < 1280; i++) {
          const progress = i / 1280,
            point = pointOnLane(lane, progress);
          assert.ok(Number.isFinite(point.angle));
          assert.ok(
            point.x > 60 && point.x < 1140 && point.y > 60 && point.y < 660,
            JSON.stringify(point),
          );
          // An independent point-to-segment distance check against the painted lane.
          const position = progress * lane.points.length;
          const a = lane.points[Math.floor(position)],
            b = lane.points[(Math.floor(position) + 1) % lane.points.length];
          const cross =
            (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
          assert.ok(Math.abs(cross) < 0.00001);
        }
      }
    }
  });
}

for (const course of RACE_COURSES) {
  test(`${course.name}: opens on a straight heading right, with the line across every lane`, () => {
    const geometry = courseGeometry(course.id, 12);
    const start = pointOnLane(geometry.centre, 0);
    assert.ok(Math.abs(start.angle) < 20, `starts heading ${start.angle}`);
    /* The start sits in the lower half, so the START / FINISH board fits below it. */
    assert.ok(start.y > 360, `start at y ${start.y}`);
    const a = pointOnLane(geometry.boundaries[0], 0);
    const b = pointOnLane(geometry.boundaries[12], 0);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - geometry.trackWidth) < 2);
    assert.ok(geometry.lanes.every((lane) => lane.length > 1000));
    assert.ok(geometry.bounds.w > 700 && geometry.bounds.h > 400);
  });
}

/** Runs of sharp turning along a lane, as signs: +1 left, -1 right (screen y down). */
const bends = (id: 'pavilion-chicane' | 'practice-nets', threshold: number) => {
  const lane = courseGeometry(id, 12).centre;
  const k = curvatures(lane);
  const runs: number[] = [];
  let current = 0;
  for (let i = 0; i < k.length; i++) {
    const sign = Math.abs(k[i]) > threshold ? Math.sign(k[i]) : 0;
    if (sign !== current) {
      if (sign) runs.push(sign);
      current = sign;
    }
  }
  return runs;
};

test('Pavilion Chicane has a real chicane: a tight kink one way, the other, then back', () => {
  /* Corners of the main circuit turn one way; the chicane adds a run the other way. */
  const runs = bends('pavilion-chicane', 1 / 110);
  const majority = Math.sign(runs.reduce((a, b) => a + b, 0));
  assert.equal(runs.filter((r) => r !== majority).length, 1, JSON.stringify(runs));
  const kerbs = kerbRuns(courseGeometry('pavilion-chicane', 12).boundaries[0], (p) => p.x > 540 && p.x < 840 && p.y < 400);
  assert.ok(kerbs.length >= 1);
});

test('Practice Nets Switchback zigzags: five hairpins between the legs, not a peanut', () => {
  const runs = bends('practice-nets', 1 / 100);
  /* Four corners of the outer loop turn one way, and the hairpins alternate. */
  assert.ok(runs.length >= 7, JSON.stringify(runs));
  let changes = 0;
  for (let i = 1; i < runs.length; i++) if (runs[i] !== runs[i - 1]) changes++;
  assert.ok(changes >= 4, JSON.stringify(runs));
});
