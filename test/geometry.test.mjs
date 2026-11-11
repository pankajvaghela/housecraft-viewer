import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { doorThresholds, objectCenter, planWalls, wallFrame, wallPanels } from '../src/geometry.mjs';

const { baseline } = JSON.parse(await readFile(new URL('../examples/two-room/housecraft.json', import.meta.url), 'utf8'));

test('wall panels leave door and window holes while preserving wall area', () => {
  const wall = { start: [1, 2], end: [4, 6], height: 3 };
  const openings = [
    { offset: 1, width: 2, bottom: 0, height: 1 },
    { offset: 2, width: 2, bottom: 1.5, height: 1 },
  ];
  assert.equal(wallFrame(wall).length, 5);
  const panels = wallPanels(wall, openings);
  const area = panels.reduce((sum, { start, end, bottom, top }) => sum + (end - start) * (top - bottom), 0);
  assert.equal(area, 11);
  assert.ok(panels.some(panel => panel.start === 2 && panel.end === 3 && panel.bottom === 1 && panel.top === 1.5));
  for (const panel of panels) {
    for (const hole of openings) {
      const overlaps = panel.start < hole.offset + hole.width && panel.end > hole.offset
        && panel.bottom < hole.bottom + hole.height && panel.top > hole.bottom;
      assert.equal(overlaps, false);
    }
  }
});

test('the internal threshold meets both floor finishes at the wall centreline', () => {
  const wall = baseline.walls.find(({ id }) => id === 'partition');
  const door = baseline.openings.find(({ wallId }) => wallId === wall.id);
  const threshold = doorThresholds(wall, door, baseline.rooms);
  assert.deepEqual(threshold, [
    { start: 0.5, end: 1.4, across: -0.03, depth: 0.06, materialId: 'bedroom-floor' },
    { start: 0.5, end: 1.4, across: 0.03, depth: 0.06, materialId: 'living-floor' },
  ]);
});

test('the exterior threshold extends the adjacent floor finish across the whole door', () => {
  const wall = baseline.walls.find(({ id }) => id === 'south');
  const door = baseline.openings.find(({ wallId }) => wallId === wall.id);
  assert.deepEqual(doorThresholds(wall, door, baseline.rooms), [
    { start: door.offset, end: door.offset + door.width, across: 0, depth: wall.thickness, materialId: 'living-floor' },
  ]);
});

test('the furniture origin is at the footprint center on the bottom face', () => {
  assert.deepEqual(objectCenter({ position: [3, 1, 5], size: [2, 4, 6] }), [3, 3, 5]);
});

test('dense staggered openings exceed the mesh budget before allocating meshes', () => {
  const wallId = baseline.walls[0].id;
  const openings = Array.from({ length: 512 }, (_, index) => ({
    id: `window-${index}`,
    wallId,
    kind: 'window',
    offset: 0.1 + index * 0.001,
    width: 5 - index * 0.002,
    bottom: index * 0.004,
    height: 0.001,
  }));
  assert.throws(() => planWalls({ ...baseline, openings }), /geometry budget/);
});
