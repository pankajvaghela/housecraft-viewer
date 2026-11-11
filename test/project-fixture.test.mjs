import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const project = JSON.parse(await readFile(new URL('../examples/two-room/housecraft.json', import.meta.url), 'utf8'));
const snapshots = [project.baseline, ...project.variants];

function uniqueIds(records) {
  assert.equal(new Set(records.map(record => record.id)).size, records.length);
  for (const record of records) assert.match(record.id, /^[a-z][a-z0-9-]*$/);
}

test('the example is a synthetic one-house project without external assets', () => {
  assert.equal(project.version, 1);
  assert.equal(project.units, 'm');
  assert.deepEqual(project.assets, []);
  assert.equal(project.variants.length, 1);
  assert.ok(project.sources.every(source => ['synthetic', 'design'].includes(source.kind)));
  uniqueIds(project.sources);
  uniqueIds(snapshots);
  assert.equal(new Set(snapshots.map(snapshot => snapshot.name)).size, snapshots.length);
});

test('each snapshot resolves its material, source and wall references', () => {
  const sources = new Set(project.sources.map(source => source.id));
  for (const snapshot of snapshots) {
    const materials = new Set(snapshot.materials.map(material => material.id));
    const walls = new Set(snapshot.walls.map(wall => wall.id));
    for (const collection of ['materials', 'rooms', 'walls', 'openings', 'objects']) uniqueIds(snapshot[collection]);
    for (const material of snapshot.materials) {
      assert.match(material.color, /^#[a-f\d]{6}$/i);
      assert.ok(material.roughness >= 0 && material.roughness <= 1);
    }
    for (const entity of [...snapshot.rooms, ...snapshot.walls, ...snapshot.openings, ...snapshot.objects]) {
      assert.ok(sources.has(entity.evidence.sourceId), entity.id);
      assert.ok(['synthetic', 'proposed'].includes(entity.evidence.basis), entity.id);
      assert.ok(entity.evidence.note.length > 0, entity.id);
      if ('materialId' in entity) assert.ok(materials.has(entity.materialId), entity.id);
      if ('wallId' in entity) assert.ok(walls.has(entity.wallId), entity.id);
    }
  }
});

test('the example has two disjoint rectangular floors inside its 6 by 4 metre shell', () => {
  for (const snapshot of snapshots) {
    assert.equal(snapshot.rooms.length, 2);
    const bounds = snapshot.rooms.map(room => {
      assert.equal(room.polygon.length, 4);
      const xs = room.polygon.map(point => point[0]);
      const zs = room.polygon.map(point => point[1]);
      assert.ok([...xs, ...zs].every(Number.isFinite));
      assert.equal(new Set(xs).size, 2);
      assert.equal(new Set(zs).size, 2);
      assert.equal(new Set(room.polygon.map(point => point.join(','))).size, 4);
      const area = room.polygon.reduce((sum, [x, z], index) => {
        const next = room.polygon[(index + 1) % room.polygon.length];
        return sum + x * next[1] - next[0] * z;
      }, 0) / 2;
      assert.ok(area > 0, room.id);
      const rectangle = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      assert.ok(rectangle.minX > 0 && rectangle.maxX < 6 && rectangle.minZ > 0 && rectangle.maxZ < 4);
      return rectangle;
    });
    assert.ok(bounds[0].maxX < bounds[1].minX);
    assert.equal(snapshot.walls.length, 5, 'four exterior walls and one shared partition');
  }
});

test('door and window holes fit their walls without overlapping', () => {
  for (const snapshot of snapshots) {
    assert.equal(snapshot.openings.filter(opening => opening.kind === 'door').length, 2);
    assert.equal(snapshot.openings.filter(opening => opening.kind === 'window').length, 2);
    for (const wall of snapshot.walls) {
      const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
      assert.ok(Number.isFinite(length) && length > 0 && wall.thickness > 0 && wall.height > 0);
      const openings = snapshot.openings.filter(opening => opening.wallId === wall.id);
      for (const opening of openings) {
        assert.ok(opening.offset >= 0 && opening.width > 0 && opening.offset + opening.width <= length, opening.id);
        assert.ok(opening.bottom >= 0 && opening.height > 0 && opening.bottom + opening.height <= wall.height, opening.id);
        if (opening.kind === 'door') assert.equal(opening.bottom, 0);
      }
      for (let i = 0; i < openings.length; i++) {
        for (const other of openings.slice(i + 1)) {
          const current = openings[i];
          const horizontalOverlap = current.offset < other.offset + other.width && other.offset < current.offset + current.width;
          const verticalOverlap = current.bottom < other.bottom + other.height && other.bottom < current.bottom + current.height;
          assert.ok(!(horizontalOverlap && verticalOverlap), `${current.id}/${other.id}`);
        }
      }
    }
  }
});

test('proxy furniture fits rooms and stays clear of the example door approaches', () => {
  for (const snapshot of snapshots) {
    assert.equal(snapshot.objects.length, 3);
    const boxes = snapshot.objects.map(object => {
      assert.equal(object.assetId, undefined);
      assert.equal(object.rotation, 0, 'this fixture uses axis-aligned furniture');
      assert.equal(object.position[1], 0);
      assert.ok(object.position.every(Number.isFinite));
      assert.ok(object.size.every(value => Number.isFinite(value) && value > 0));
      assert.ok(object.size[1] < 2.6);
      const [x, , z] = object.position;
      const [width, , depth] = object.size;
      const box = { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
      assert.ok(snapshot.rooms.some(room => {
        const xs = room.polygon.map(point => point[0]);
        const zs = room.polygon.map(point => point[1]);
        return box.minX >= Math.min(...xs) && box.maxX <= Math.max(...xs) && box.minZ >= Math.min(...zs) && box.maxZ <= Math.max(...zs);
      }), object.id);
      assert.ok(box.minZ >= 1.5, 'keep the entry/partition door approach band clear');
      return box;
    });
    for (let i = 0; i < boxes.length; i++) {
      for (const other of boxes.slice(i + 1)) {
        const box = boxes[i];
        assert.ok(box.maxX <= other.minX || other.maxX <= box.minX || box.maxZ <= other.minZ || other.maxZ <= box.minZ);
      }
    }
  }
});

test('the renovation preserves the shell and is independently editable after a JSON round-trip', () => {
  const restored = JSON.parse(JSON.stringify(project));
  assert.deepEqual(restored, project);
  const variant = restored.variants[0];
  for (const field of ['walls', 'openings', 'rooms']) assert.deepEqual(variant[field], restored.baseline[field]);
  assert.notEqual(variant.lighting, restored.baseline.lighting);
  assert.notDeepEqual(variant.objects, restored.baseline.objects);
  assert.notDeepEqual(variant.materials, restored.baseline.materials);
  assert.equal(variant.structuralReview, 'not-assessed');
  variant.objects[0].position[0] = 2;
  variant.materials[0].color = '#000000';
  assert.deepEqual(restored.baseline, project.baseline);
});
