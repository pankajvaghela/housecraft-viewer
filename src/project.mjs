import { planWalls, wallFrame } from './geometry.mjs';

export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
const MAX_METRES = 10_000;
const MAX_ENTITIES = 4096;
const MAX_VERTICES = 8192;
const encoder = new TextEncoder();

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function field(path, key) {
  return path === '$' ? key : `${path}.${key}`;
}

function record(value, path, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(path, 'expected a plain object');
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      const keyPath = /^[a-zA-Z][a-zA-Z0-9]*$/.test(key) ? field(path, key) : `${path}[${JSON.stringify(key)}]`;
      fail(keyPath, 'unknown field');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(field(path, key), 'required field');
  }
}

function list(value, path, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(path, min === max ? `expected an array of ${max} entries` : `expected an array of ${min}–${max} entries`);
  }
}

function text(value, path, max, min = 1) {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min) {
    fail(path, min ? `expected nonempty text up to ${max} characters` : `expected text up to ${max} characters`);
  }
}

function identifier(value, path) {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z][a-z0-9-]*$/.test(value)) {
    fail(path, 'expected an ID matching [a-z][a-z0-9-]* with at most 64 characters');
  }
}

function choice(value, path, options) {
  if (!options.includes(value)) fail(path, `expected one of ${options.join(', ')}`);
}

function number(value, path, { min = -MAX_METRES, max = MAX_METRES } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected a finite number between ${min} and ${max}`);
  }
}

function positive(value, path) {
  number(value, path, { min: 0 });
  if (value === 0) fail(path, 'expected a positive number');
}

function vector(value, path, length, validate = number) {
  list(value, path, length, length);
  for (let index = 0; index < length; index++) validate(value[index], `${path}[${index}]`);
}

function unique(value, seen, path) {
  if (seen.has(value)) fail(path, 'duplicate value');
  seen.add(value);
}

function reference(value, known, path) {
  identifier(value, path);
  if (!known.has(value)) fail(path, `unknown ID "${value}"`);
}

function collection(items, path, limits, budget, validate) {
  list(items, path, limits.min, limits.max);
  budget.entities -= items.length;
  if (budget.entities < 0) fail(path, `project exceeds the ${MAX_ENTITIES}-entity limit`);

  const ids = new Set();
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}[${index}]`;
    validate(item, itemPath);
    identifier(item.id, `${itemPath}.id`);
    unique(item.id, ids, `${itemPath}.id`);
  }
  return ids;
}

function validateEvidence(value, path, sources) {
  record(value, path, ['sourceId', 'basis', 'note']);
  reference(value.sourceId, sources, `${path}.sourceId`);
  choice(value.basis, `${path}.basis`, ['measured', 'estimated', 'proposed', 'synthetic']);
  text(value.note, `${path}.note`, 2048);
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, point) {
  return point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) &&
    point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a, b, c, d) {
  const abC = Math.sign(cross(a, b, c));
  const abD = Math.sign(cross(a, b, d));
  const cdA = Math.sign(cross(c, d, a));
  const cdB = Math.sign(cross(c, d, b));
  return (abC * abD < 0 && cdA * cdB < 0) ||
    (abC === 0 && onSegment(a, b, c)) ||
    (abD === 0 && onSegment(a, b, d)) ||
    (cdA === 0 && onSegment(c, d, a)) ||
    (cdB === 0 && onSegment(c, d, b));
}

function validatePolygon(points, path, budget) {
  list(points, path, 3, 128);
  budget.vertices -= points.length;
  if (budget.vertices < 0) fail(path, `project exceeds the ${MAX_VERTICES}-vertex limit`);

  const seen = new Set();
  for (const [index, point] of points.entries()) {
    const pointPath = `${path}[${index}]`;
    vector(point, pointPath, 2);
    unique(point.join(','), seen, pointPath);
  }

  let twiceArea = 0;
  for (let index = 1; index < points.length - 1; index++) {
    twiceArea += cross(points[0], points[index], points[index + 1]);
  }
  if (twiceArea === 0) fail(path, 'expected a room with positive area');

  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const dot = (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]);
    if (cross(a, b, c) === 0 && dot > 0) fail(path, 'expected a simple polygon without backtracking edges');

    for (let other = index + 2; other < points.length; other++) {
      if (index === 0 && other === points.length - 1) continue;
      if (segmentsIntersect(a, b, points[other], points[(other + 1) % points.length])) {
        fail(path, 'expected a simple polygon without intersecting edges');
      }
    }
  }
}

function validateSource(source, path) {
  record(source, path, ['id', 'label', 'kind']);
  text(source.label, `${path}.label`, 256);
  choice(source.kind, `${path}.kind`, ['measurement', 'floor-plan', 'photo', 'design', 'synthetic']);
}

function validateMaterial(material, path) {
  record(material, path, ['id', 'color', 'roughness']);
  if (typeof material.color !== 'string' || !/^#[a-f\d]{6}$/i.test(material.color)) {
    fail(`${path}.color`, 'expected a six-digit #RRGGBB color');
  }
  number(material.roughness, `${path}.roughness`, { min: 0, max: 1 });
}

function validateRoom(room, path, budget) {
  record(room, path, ['id', 'name', 'polygon', 'materialId', 'evidence']);
  text(room.name, `${path}.name`, 256);
  validatePolygon(room.polygon, `${path}.polygon`, budget);
}

function validateWall(wall, path) {
  record(wall, path, ['id', 'start', 'end', 'thickness', 'height', 'materialId', 'evidence']);
  vector(wall.start, `${path}.start`, 2);
  vector(wall.end, `${path}.end`, 2);
  if (wall.start.every((coordinate, index) => coordinate === wall.end[index])) {
    fail(`${path}.end`, 'must differ from the wall start');
  }
  positive(wall.thickness, `${path}.thickness`);
  positive(wall.height, `${path}.height`);
}

function unsupportedAsset(path) {
  fail(path, 'GLB assets are not supported by this preview. Use dimensioned proxies with no assetId and an empty assets array.');
}

function validateObject(object, path) {
  record(object, path, ['id', 'name', 'position', 'size', 'rotation', 'materialId', 'evidence'], ['assetId']);
  if (Object.hasOwn(object, 'assetId')) unsupportedAsset(`${path}.assetId`);
  text(object.name, `${path}.name`, 256);
  vector(object.position, `${path}.position`, 3);
  vector(object.size, `${path}.size`, 3, positive);
  number(object.rotation, `${path}.rotation`, { min: -180, max: 180 });
}

function exceeds(value, limit) {
  // Allow roundoff at edges that touch, such as 0.1 + 0.2 and 0.3.
  return value - limit > 4 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(limit));
}

function validateOpening(opening, path, walls) {
  record(opening, path, ['id', 'wallId', 'kind', 'offset', 'width', 'bottom', 'height', 'evidence']);
  reference(opening.wallId, walls, `${path}.wallId`);
  choice(opening.kind, `${path}.kind`, ['door', 'window']);
  number(opening.offset, `${path}.offset`, { min: 0 });
  positive(opening.width, `${path}.width`);
  number(opening.bottom, `${path}.bottom`, { min: 0 });
  positive(opening.height, `${path}.height`);
  if (opening.kind === 'door' && opening.bottom !== 0) fail(`${path}.bottom`, 'a door must start at zero');

  const wall = walls.get(opening.wallId);
  const right = opening.offset + opening.width;
  const top = opening.bottom + opening.height;
  if (right <= opening.offset || exceeds(right, wall.length)) fail(`${path}.width`, 'opening must fit within the wall length');
  if (top <= opening.bottom || exceeds(top, wall.height)) fail(`${path}.height`, 'opening must fit within the wall height');

  for (const other of wall.openings) {
    const left = Math.max(opening.offset, other.offset);
    const bottom = Math.max(opening.bottom, other.bottom);
    if (exceeds(Math.min(right, other.right), left) && exceeds(Math.min(top, other.top), bottom)) {
      fail(path, `opening overlaps ${other.path}`);
    }
  }
  wall.openings.push({ offset: opening.offset, bottom: opening.bottom, right, top, path });
}

function validateSnapshot(snapshot, path, context) {
  record(snapshot, path, ['id', 'name', 'notes', 'structuralReview', 'lighting', 'materials', 'rooms', 'walls', 'openings', 'objects']);
  identifier(snapshot.id, `${path}.id`);
  unique(snapshot.id, context.snapshotIds, `${path}.id`);
  text(snapshot.name, `${path}.name`, 256);
  unique(snapshot.name, context.snapshotNames, `${path}.name`);
  text(snapshot.notes, `${path}.notes`, 2048, 0);
  choice(snapshot.structuralReview, `${path}.structuralReview`, ['not-assessed']);
  choice(snapshot.lighting, `${path}.lighting`, ['daylight', 'warm']);

  const { sources, budget } = context;
  const materials = collection(snapshot.materials, `${path}.materials`, { min: 1, max: 256 }, budget, validateMaterial);
  function validateGeometryReferences(entity, entityPath) {
    reference(entity.materialId, materials, `${entityPath}.materialId`);
    validateEvidence(entity.evidence, `${entityPath}.evidence`, sources);
  }

  collection(snapshot.rooms, `${path}.rooms`, { min: 1, max: 128 }, budget, (room, roomPath) => {
    validateRoom(room, roomPath, budget);
    validateGeometryReferences(room, roomPath);
  });
  collection(snapshot.walls, `${path}.walls`, { min: 1, max: 512 }, budget, (wall, wallPath) => {
    validateWall(wall, wallPath);
    validateGeometryReferences(wall, wallPath);
  });
  const walls = new Map(snapshot.walls.map(wall => [wall.id, {
    length: wallFrame(wall).length,
    height: wall.height,
    openings: [],
  }]));
  collection(snapshot.openings, `${path}.openings`, { min: 0, max: 512 }, budget, (opening, openingPath) => {
    validateOpening(opening, openingPath, walls);
    validateEvidence(opening.evidence, `${openingPath}.evidence`, sources);
  });
  collection(snapshot.objects, `${path}.objects`, { min: 0, max: 512 }, budget, (object, objectPath) => {
    validateObject(object, objectPath);
    validateGeometryReferences(object, objectPath);
  });
  try {
    planWalls(snapshot);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`, { cause: error });
  }
}

export function validateProject(project) {
  if (project && Object.hasOwn(project, 'version') && project.version !== 1) {
    fail('version', 'unsupported project version. Expected 1');
  }
  record(project, '$', ['version', 'name', 'units', 'sources', 'assets', 'baseline', 'variants']);
  text(project.name, 'name', 256);
  choice(project.units, 'units', ['m']);
  if (Array.isArray(project.assets) && project.assets.length > 0) unsupportedAsset('assets[0]');
  list(project.assets, 'assets', 0, 0);
  list(project.variants, 'variants', 0, 16);

  const budget = { entities: MAX_ENTITIES, vertices: MAX_VERTICES };
  const sources = collection(project.sources, 'sources', { min: 0, max: 256 }, budget, validateSource);
  const context = { sources, budget, snapshotIds: new Set(), snapshotNames: new Set() };
  validateSnapshot(project.baseline, 'baseline', context);
  for (const [index, variant] of project.variants.entries()) {
    validateSnapshot(variant, `variants[${index}]`, context);
  }
  return project;
}

function fitsByteLimit(value) {
  return value.length <= MAX_PROJECT_BYTES && encoder.encode(value).byteLength <= MAX_PROJECT_BYTES;
}

export function parseProject(value) {
  if (typeof value !== 'string') fail('$', 'expected JSON text');
  if (!fitsByteLimit(value)) fail('$', `project exceeds the ${MAX_PROJECT_BYTES}-byte limit`);
  let project;
  try {
    project = JSON.parse(value);
  } catch (error) {
    throw new Error('$: invalid JSON', { cause: error });
  }
  return validateProject(project);
}

export function serializeProject(project) {
  validateProject(project);
  const formatted = JSON.stringify(project, null, 2) + '\n';
  if (fitsByteLimit(formatted)) return formatted;
  const compact = JSON.stringify(project);
  if (fitsByteLimit(compact)) return compact;
  fail('$', `project exceeds the ${MAX_PROJECT_BYTES}-byte limit`);
}
