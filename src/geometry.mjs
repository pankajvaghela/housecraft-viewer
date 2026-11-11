const MAX_WALL_PARTS = 8192;

export function wallFrame({ start, end }) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  return { length: Math.hypot(dx, dz), angle: Math.atan2(dz, dx) };
}

export function wallPanels(wall, openings, limit = MAX_WALL_PARTS) {
  const { length } = wallFrame(wall);
  const edges = [...new Set([0, length, ...openings.flatMap(({ offset, width }) => [offset, Math.min(length, offset + width)])])];
  edges.sort((a, b) => a - b);
  const panels = [];
  function addPanel(panel) {
    if (panels.length >= limit) throw tooManyWallParts(wall);
    panels.push(panel);
  }
  for (let index = 1; index < edges.length; index++) {
    const start = edges[index - 1];
    const end = edges[index];
    const holes = openings
      .filter(({ offset, width }) => offset < end && offset + width > start)
      .sort((a, b) => a.bottom - b.bottom);
    let bottom = 0;
    for (const hole of holes) {
      const top = Math.min(hole.bottom, wall.height);
      if (bottom < top) addPanel({ start, end, bottom, top });
      bottom = Math.max(bottom, hole.bottom + hole.height);
    }
    if (bottom < wall.height) addPanel({ start, end, bottom, top: wall.height });
  }
  return panels;
}

function floorIntervals(wall, rooms, face, doorStart, doorEnd) {
  const { angle } = wallFrame(wall);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const intervals = [];
  for (const { polygon, materialId } of rooms) {
    const corners = polygon.map(([x, z]) => {
      const dx = x - wall.start[0];
      const dz = z - wall.start[1];
      return [dx * cosine + dz * sine, -dx * sine + dz * cosine];
    });
    const crossings = [];
    for (let index = 0; index < corners.length; index++) {
      const [along, across] = corners[index];
      const [nextAlong, nextAcross] = corners[(index + 1) % corners.length];
      if ((across > face) === (nextAcross > face)) continue;
      crossings.push(along + (nextAlong - along) * ((face - across) / (nextAcross - across)));
    }
    crossings.sort((a, b) => a - b);
    for (let index = 1; index < crossings.length; index += 2) {
      const start = Math.max(doorStart, crossings[index - 1]);
      const end = Math.min(doorEnd, crossings[index]);
      if (start < end) intervals.push({ start, end, materialId });
    }
  }
  return intervals;
}

export function doorThresholds(wall, door, rooms) {
  const half = wall.thickness / 2;
  // Sample just inside the rooms so coincident floor edges count on both sides.
  const face = half + Math.min(0.000001, half / 1000);
  const start = door.offset;
  const end = Math.min(start + door.width, wallFrame(wall).length);
  const negative = floorIntervals(wall, rooms, -face, start, end);
  const positive = floorIntervals(wall, rooms, face, start, end);
  const edges = [...new Set([start, end, ...[...negative, ...positive].flatMap(interval => [interval.start, interval.end])])];
  edges.sort((a, b) => a - b);
  const thresholds = [];
  for (let index = 1; index < edges.length; index++) {
    const start = edges[index - 1];
    const end = edges[index];
    const materialAt = intervals => intervals.find(interval => interval.start < end && interval.end > start)?.materialId;
    const negativeMaterial = materialAt(negative);
    const positiveMaterial = materialAt(positive);
    if (negativeMaterial && positiveMaterial && negativeMaterial !== positiveMaterial) {
      thresholds.push({ start, end, across: -half / 2, depth: half, materialId: negativeMaterial });
      thresholds.push({ start, end, across: half / 2, depth: half, materialId: positiveMaterial });
    } else {
      thresholds.push({ start, end, across: 0, depth: wall.thickness, materialId: negativeMaterial ?? positiveMaterial ?? wall.materialId });
    }
  }
  return thresholds;
}

export function objectCenter({ position: [x, y, z], size: [, height] }) {
  return [x, y + height / 2, z];
}

function tooManyWallParts(wall) {
  return new Error(`Wall ${wall.id} exceeds this version’s geometry budget of ${MAX_WALL_PARTS} wall panels and threshold sections per house version. Simplify the wall openings or nearby floor polygons.`);
}

export function planWalls(snapshot) {
  const byWall = Map.groupBy(snapshot.openings, opening => opening.wallId);
  let remaining = MAX_WALL_PARTS;
  return snapshot.walls.map(wall => {
    const openings = byWall.get(wall.id) ?? [];
    const panels = wallPanels(wall, openings, remaining);
    remaining -= panels.length;
    const thresholds = [];
    for (const door of openings.filter(({ kind }) => kind === 'door')) {
      const sections = doorThresholds(wall, door, snapshot.rooms);
      remaining -= sections.length;
      if (remaining < 0) throw tooManyWallParts(wall);
      thresholds.push(...sections);
    }
    return { wall, panels, thresholds };
  });
}
