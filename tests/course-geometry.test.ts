import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseGeometry, pointOnLane } from '../lib/course-geometry';
import { RACE_COURSES } from '../lib/courses';

for (const course of RACE_COURSES) {
  test(`${course.name}: 8, 10 and 20 runners stay on closed, bounded lanes`, () => {
    for (const count of [8, 10, 20]) {
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
