import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAX_PROJECT_BYTES, parseProject, serializeProject, validateProject } from '../src/project.mjs';

const fixture = readFileSync(new URL('../examples/two-room/housecraft.json', import.meta.url), 'utf8');

test('round-trips a complete variant independently of the baseline', () => {
  const project = parseProject(fixture);
  project.variants[0].materials[0].color = '#0000FF';
  project.variants[0].openings = [];
  project.variants[0].objects = [];

  const restored = parseProject(serializeProject(project));
  assert.deepEqual(restored, project);
  assert.deepEqual(restored.baseline, parseProject(fixture).baseline);
});

const invalidEdits = [
  ['unknown field', project => { project.baseline.extra = true; }, /baseline\.extra: unknown field/],
  ['unknown version', project => { project.version = 2; }, /version:.*unsupported/],
  ['wrong units', project => { project.units = 'cm'; }, /units:.*m/],
  ['missing dimension', project => { delete project.baseline.objects[0].size; }, /baseline\.objects\[0\]\.size:.*required/],
  ['nonfinite geometry', project => { project.baseline.walls[0].height = Infinity; }, /baseline\.walls\[0\]\.height:.*finite/],
  ['oversized geometry', project => { project.baseline.walls[0].end = [10001, 0]; }, /baseline\.walls\[0\]\.end\[0\]:/],
  ['oversized notes', project => { project.baseline.notes = 'a'.repeat(2049); }, /baseline\.notes:.*2048/],
  ['oversized wall collection', project => { project.baseline.walls.length = 513; }, /baseline\.walls:.*512/],
  ['duplicate material', project => { project.baseline.materials.push(project.baseline.materials[0]); }, /baseline\.materials\[6\]\.id:.*duplicate/],
  ['duplicate snapshot name', project => { project.variants[0].name = project.baseline.name; }, /variants\[0\]\.name:.*duplicate/],
  ['missing source', project => { project.baseline.rooms[0].evidence.sourceId = 'missing'; }, /baseline\.rooms\[0\]\.evidence\.sourceId:.*unknown/],
  ['material from another snapshot', project => { project.variants[0].materials = project.variants[0].materials.filter(({ id }) => id !== 'wall'); }, /variants\[0\]\.walls\[0\]\.materialId:.*unknown/],
  ['self-intersection with nonzero area', project => { project.baseline.rooms[0].polygon = [[0, 0], [4, 3], [0, 4], [4, 0], [5, 4]]; }, /baseline\.rooms\[0\]\.polygon:.*simple/],
  ['a backtracking edge', project => { project.baseline.rooms[0].polygon = [[0, 0], [4, 0], [2, 0], [4, 4], [0, 4]]; }, /baseline\.rooms\[0\]\.polygon:.*simple/],
  ['zero-area room', project => { project.baseline.rooms[0].polygon = [[0, 0], [1, 1], [2, 2]]; }, /baseline\.rooms\[0\]\.polygon:.*area/],
  ['repeated vertex', project => { const polygon = project.baseline.rooms[0].polygon; polygon.push(polygon[0]); }, /baseline\.rooms\[0\]\.polygon\[4\]:.*duplicate/],
  ['zero-length wall', project => { project.baseline.walls[0].end = project.baseline.walls[0].start; }, /baseline\.walls\[0\]\.end:.*start/],
  ['opening past wall end', project => { project.baseline.openings[0].width = 10; }, /baseline\.openings\[0\]\.width:.*wall length/],
  ['opening above wall top', project => { project.baseline.openings[0].height = 10; }, /baseline\.openings\[0\]\.height:.*wall height/],
  ['door off floor', project => { project.baseline.openings[0].bottom = 0.1; }, /baseline\.openings\[0\]\.bottom:.*zero/],
  ['overlapping openings', project => { project.baseline.openings.push({ ...project.baseline.openings[0], id: 'extra-door' }); }, /baseline\.openings\[4\]:.*overlaps/],
  ['declared asset', project => { project.assets = [{ id: 'remote', path: 'https://example.test/model.glb' }]; }, /assets\[0\]:.*GLB.*proxies/],
  ['asset reference', project => { project.baseline.objects[0].assetId = 'missing'; }, /baseline\.objects\[0\]\.assetId:.*GLB.*proxies/],
];

for (const [description, edit, error] of invalidEdits) {
  test(`rejects ${description} with its field path`, () => {
    const project = JSON.parse(fixture);
    edit(project);
    assert.throws(() => validateProject(project), error);
  });
}

test('accepts both room windings and openings whose edges only touch', () => {
  const project = JSON.parse(fixture);
  project.baseline.rooms[0].polygon.reverse();
  const door = project.baseline.openings[0];
  project.baseline.openings.push({
    ...door,
    id: 'above-door',
    kind: 'window',
    bottom: door.height,
    height: 0.1,
  });
  assert.equal(validateProject(project), project);
});

test('rejects malformed or oversized project text before it is imported', () => {
  assert.throws(() => parseProject('{'), /invalid JSON/);
  assert.throws(() => parseProject('é'.repeat(MAX_PROJECT_BYTES / 2 + 1)), /byte limit/);
});

test('limits the number of entity records across all snapshots', () => {
  const project = JSON.parse(fixture);
  const baseline = project.baseline;
  baseline.materials.push(...Array.from({ length: 250 }, (_, index) => ({
    ...baseline.materials[0], id: `finish-${index}`,
  })));
  project.variants = Array.from({ length: 16 }, (_, index) => ({
    ...baseline, id: `variant-${index}`, name: `Variant ${index}`,
  }));

  assert.throws(() => validateProject(project), /variants\[\d+\]\.\w+:.*4096-entity limit/);
});

test('limits the total number of polygon vertices', () => {
  const project = JSON.parse(fixture);
  const polygon = Array.from({ length: 128 }, (_, index) => {
    const angle = index * Math.PI / 64;
    return [Math.cos(angle), Math.sin(angle)];
  });
  project.baseline.rooms = Array.from({ length: 65 }, (_, index) => ({
    ...project.baseline.rooms[0], id: `room-${index}`, polygon,
  }));

  assert.throws(() => validateProject(project), /baseline\.rooms\[64\]\.polygon:.*8192-vertex limit/);
});

test('rejects a render-expanding opening layout during validation', () => {
  const project = JSON.parse(fixture);
  const wall = project.baseline.walls[0];
  project.baseline.openings = Array.from({ length: 512 }, (_, index) => ({
    id: `window-${index}`,
    wallId: wall.id,
    kind: 'window',
    offset: 0.1 + index * 0.001,
    width: 5 - index * 0.002,
    bottom: index * 0.004,
    height: 0.001,
    evidence: wall.evidence,
  }));

  assert.throws(() => validateProject(project), /baseline:.*geometry budget.*8192/);
});
