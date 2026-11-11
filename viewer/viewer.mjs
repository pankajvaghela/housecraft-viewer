import * as THREE from 'three';
import { OrbitControls } from '/vendor/three/addons/controls/OrbitControls.js';
import { MAX_PROJECT_BYTES, parseProject, serializeProject } from '/src/project.mjs';
import { objectCenter, planWalls, wallFrame } from '/src/geometry.mjs';

const byId = id => document.getElementById(id);
const viewport = byId('viewport');
const importButton = byId('import-project');
const exportButton = byId('export-project');
const projectFile = byId('project-file');
const snapshotSelect = byId('snapshot');
const resetButton = byId('reset-view');
const labelLayer = byId('model-labels');

function addBox(group, material, size, center) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...center);
  group.add(mesh);
  return mesh;
}

function addWalls(model, wallPlan, materials) {
  for (const { wall, panels, thresholds } of wallPlan) {
    const group = new THREE.Group();
    group.position.set(wall.start[0], 0, wall.start[1]);
    group.rotation.y = -wallFrame(wall).angle;
    model.add(group);
    for (const { start, end, bottom, top } of panels) {
      addBox(group, materials.get(wall.materialId), [end - start, top - bottom, wall.thickness], [(start + end) / 2, (bottom + top) / 2, 0]);
    }
    for (const { start, end, across, depth, materialId } of thresholds) {
      const floorDepth = 0.04;
      addBox(group, materials.get(materialId), [end - start, floorDepth, depth], [(start + end) / 2, -floorDepth / 2, across]);
    }
  }
}

function buildModel(snapshot) {
  const wallPlan = planWalls(snapshot);
  const model = new THREE.Group();
  const materials = new Map(snapshot.materials.map(({ id, color, roughness }) => [
    id, new THREE.MeshStandardMaterial({ color, roughness }),
  ]));
  for (const { polygon, materialId } of snapshot.rooms) {
    const shape = new THREE.Shape(polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), materials.get(materialId));
    floor.rotation.x = -Math.PI / 2;
    model.add(floor);
  }
  addWalls(model, wallPlan, materials);
  const labels = snapshot.objects.map(object => {
    const mesh = addBox(model, materials.get(object.materialId), object.size, objectCenter(object));
    mesh.rotation.y = THREE.MathUtils.degToRad(object.rotation);
    const [x, y, z] = object.position;
    const anchor = new THREE.Vector3(x, y + object.size[1] + 0.06, z);
    const element = document.createElement('span');
    element.className = 'model-label';
    element.textContent = object.name;
    return { anchor, element };
  });

  const bounds = new THREE.Box3().setFromObject(model);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.1);
  const gridSize = 4 * radius;
  const grid = new THREE.GridHelper(gridSize, 24, 0xc4c7bb, 0xd4d7cb);
  grid.position.set(sphere.center.x, -0.06, sphere.center.z);
  model.add(grid);
  return { model, materials, sphere, labels, grid };
}

function disposeModel({ model, materials, grid }) {
  model.traverse(mesh => {
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  grid.dispose();
  for (const material of materials.values()) material.dispose();
}

function createViewer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive 3D house model');
  canvas.setAttribute('aria-describedby', 'model-help');
  viewport.prepend(canvas);
  canvas.addEventListener('webglcontextlost', () => {
    showError('The 3D view lost its graphics connection. Reload the page to reopen the viewer.');
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e9e0);
  const sky = new THREE.HemisphereLight(0xf7faff, 0xa49a8a, 2);
  const sun = new THREE.DirectionalLight(0xfff7ed, 2);
  sun.position.set(-4, 8, 5);
  scene.add(sky, sun);
  const camera = new THREE.OrthographicCamera();
  const controls = new OrbitControls(camera, canvas);
  controls.minZoom = 0.25;
  controls.maxZoom = 6;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.listenToKeyEvents(canvas);
  const startingDirection = new THREE.Vector3(-0.69, 2.5, -0.93).normalize();
  const projected = new THREE.Vector3();
  let active;
  let viewRadius = 1;

  function draw() {
    if (!active || !canvas.clientWidth || !canvas.clientHeight) return;
    renderer.render(scene, camera);
    for (const { anchor, element } of active.labels) {
      projected.copy(anchor).project(camera);
      element.hidden = Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1;
      if (!element.hidden) {
        const x = (projected.x + 1) * canvas.clientWidth / 2;
        const y = (1 - projected.y) * canvas.clientHeight / 2;
        element.style.transform = `translate(${x}px, ${y}px)`;
      }
    }
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = viewport;
    if (!width || !height) return;
    const aspect = width / height;
    const vertical = viewRadius * 1.08 / Math.min(1, aspect);
    camera.left = -vertical * aspect;
    camera.right = vertical * aspect;
    camera.top = vertical;
    camera.bottom = -vertical;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    draw();
  }

  function reset() {
    const { center, radius } = active.sphere;
    viewRadius = Math.max(radius, 0.1);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(startingDirection, viewRadius * 3);
    camera.near = viewRadius / 100;
    camera.far = viewRadius * 12;
    camera.zoom = 1;
    controls.update();
    resize();
  }

  controls.addEventListener('change', draw);
  canvas.addEventListener('keydown', event => {
    if (event.key !== '+' && event.key !== '-' && event.key !== '=') return;
    event.preventDefault();
    camera.zoom = THREE.MathUtils.clamp(camera.zoom * (event.key === '-' ? 1 / 1.15 : 1.15), controls.minZoom, controls.maxZoom);
    camera.updateProjectionMatrix();
    draw();
  });
  new ResizeObserver(resize).observe(viewport);

  return {
    setSnapshot(snapshot, { resetView }) {
      const next = buildModel(snapshot);
      if (active) {
        scene.remove(active.model);
        disposeModel(active);
      }
      active = next;
      scene.add(next.model);
      labelLayer.replaceChildren(...next.labels.map(({ element }) => element));
      const warm = snapshot.lighting === 'warm';
      scene.background.setHex(warm ? 0xeee7db : 0xe9e9e0);
      sky.color.setHex(warm ? 0xffedd3 : 0xf7faff);
      sun.color.setHex(warm ? 0xffce96 : 0xfff7ed);
      if (resetView) reset();
      else draw();
    },
    reset,
  };
}

function showError(message) {
  const error = byId('project-error');
  error.textContent = message;
  error.hidden = !message;
}

function updateMeasurements(snapshot, sources) {
  const sourceLabels = new Map(sources.map(source => [source.id, source.label]));
  const evidenceLabels = {
    measured: 'Measured dimensions',
    estimated: 'Estimated dimensions',
    synthetic: 'Add your dimensions',
    proposed: 'Proposed dimensions or placement',
  };
  const entities = [
    ...snapshot.rooms.map(room => [room.name, room.evidence]),
    ...snapshot.walls.map(wall => ['Wall · ' + wall.id, wall.evidence]),
    ...snapshot.openings.map(opening => [opening.kind + ' · ' + opening.id, opening.evidence]),
    ...snapshot.objects.map(object => [object.name, object.evidence]),
  ];
  const bases = new Set();
  const rows = entities.map(([name, evidence]) => {
    bases.add(evidence.basis);
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    heading.textContent = name;
    const source = document.createElement('span');
    source.className = 'measurement-source';
    const sourceLabel = sourceLabels.get(evidence.sourceId);
    source.textContent = evidence.basis === 'synthetic' ? sourceLabel : evidenceLabels[evidence.basis] + ' · ' + sourceLabel;
    const note = document.createElement('p');
    note.className = 'measurement-note';
    note.textContent = evidence.note;
    item.append(heading, source, note);
    return item;
  });
  byId('measurements').replaceChildren(...rows);
  byId('project-evidence').textContent = [...bases].map(basis => evidenceLabels[basis]).join(' · ');
}

function updateDetails(snapshot, project) {
  byId('snapshot-name').textContent = snapshot.name;
  const notes = byId('snapshot-notes');
  notes.textContent = snapshot.notes;
  notes.hidden = !snapshot.notes;
  byId('review-note').hidden = snapshot === project.baseline;
  const rooms = snapshot.rooms.map(room => {
    const item = document.createElement('li');
    item.textContent = room.name;
    return item;
  });
  byId('room-list').replaceChildren(...rooms);

  const colors = new Map(snapshot.materials.map(({ id, color }) => [id, color]));
  const furniture = snapshot.objects.map(object => {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = colors.get(object.materialId);
    swatch.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = object.name;
    const dimensions = document.createElement('span');
    dimensions.className = 'dimensions';
    dimensions.textContent = object.size.join(' × ') + ' m';
    name.append(dimensions);
    item.append(swatch, name);
    return item;
  });
  const empty = document.createElement('li');
  empty.textContent = 'No furniture in this version.';
  byId('furniture-list').replaceChildren(...(furniture.length ? furniture : [empty]));
  byId('dimension-key').hidden = !furniture.length;
  document.querySelector('.details').hidden = false;

  updateMeasurements(snapshot, project.sources);
}

function decodeProject(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('Project JSON must be valid UTF-8.', { cause: error });
  }
}

async function start() {
  const message = byId('viewport-message');
  let viewer;
  try {
    viewer = createViewer();
  } catch {
    message.textContent = 'The 3D view requires WebGL 2.';
    showError('Open this page in a browser with WebGL 2 and hardware acceleration enabled.');
    return;
  }

  let project;
  function openProject(candidate) {
    viewer.setSnapshot(candidate.baseline, { resetView: true });
    project = candidate;
    byId('project-name').textContent = project.name;
    const options = [project.baseline, ...project.variants].map(snapshot => new Option(snapshot.name, snapshot.id));
    snapshotSelect.replaceChildren(...options);
    snapshotSelect.value = project.baseline.id;
    updateDetails(project.baseline, project);
    message.hidden = true;
    exportButton.disabled = snapshotSelect.disabled = resetButton.disabled = false;
    showError('');
    byId('project-status').textContent = project.name + ' loaded.';
  }

  snapshotSelect.addEventListener('change', () => {
    const snapshot = [project.baseline, ...project.variants].find(({ id }) => id === snapshotSelect.value);
    viewer.setSnapshot(snapshot, { resetView: false });
    updateDetails(snapshot, project);
  });
  resetButton.addEventListener('click', viewer.reset);
  importButton.addEventListener('click', () => projectFile.click());
  projectFile.addEventListener('change', async () => {
    const file = projectFile.files[0];
    projectFile.value = '';
    if (!file) return;
    importButton.disabled = true;
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error(`Choose a JSON file under ${MAX_PROJECT_BYTES.toLocaleString()} bytes.`);
      openProject(parseProject(decodeProject(await file.arrayBuffer())));
    } catch (error) {
      showError('Could not open project. ' + error.message);
    } finally {
      importButton.disabled = false;
    }
  });
  exportButton.addEventListener('click', () => {
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'housecraft.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  try {
    const response = await fetch('/project.json');
    if (!response.ok) throw new Error(`The local server returned HTTP ${response.status}.`);
    openProject(parseProject(decodeProject(await response.arrayBuffer())));
  } catch (error) {
    message.textContent = 'Open a HouseCraft project to view it here.';
    showError('Could not load the starting project. ' + error.message);
  } finally {
    importButton.disabled = false;
  }
}

await start();
