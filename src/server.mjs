import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { MAX_PROJECT_BYTES, parseProject, serializeProject } from './project.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4173;
const JS = 'text/javascript; charset=utf-8';
const IMPORT_MAP = '{"imports":{"three":"/vendor/three/three.module.js"}}';
const importMapHash = createHash('sha256').update(IMPORT_MAP).digest('base64');
const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'none'",
    `script-src 'self' 'sha256-${importMapHash}'`,
    "style-src 'self'",
    "connect-src 'self'",
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export async function loadProject(inputPath) {
  const input = resolve(inputPath);
  const file = (await stat(input)).isDirectory() ? join(input, 'housecraft.json') : input;
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Project path must point to a regular JSON file.');
    if (info.size > MAX_PROJECT_BYTES) throw new Error(`Project file exceeds the ${MAX_PROJECT_BYTES}-byte limit.`);

    const bytes = Buffer.alloc(MAX_PROJECT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_PROJECT_BYTES) throw new Error(`Project file exceeds the ${MAX_PROJECT_BYTES}-byte limit.`);

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    } catch (error) {
      throw new Error('Project file must be valid UTF-8.', { cause: error });
    }
    return parseProject(text);
  } finally {
    await handle.close();
  }
}

async function previewRoutes(project) {
  let threeModule;
  let orbitControls;
  try {
    threeModule = new URL(import.meta.resolve('three'));
    orbitControls = new URL(import.meta.resolve('three/addons/controls/OrbitControls.js'));
  } catch (error) {
    throw new Error('Preview dependencies are missing. Run npm ci from the HouseCraft Viewer directory.', { cause: error });
  }

  const files = [
    ['/', new URL('../viewer/index.html', import.meta.url), 'text/html; charset=utf-8'],
    ['/viewer/viewer.mjs', new URL('../viewer/viewer.mjs', import.meta.url), JS],
    ['/viewer/styles.css', new URL('../viewer/styles.css', import.meta.url), 'text/css; charset=utf-8'],
    ['/src/geometry.mjs', new URL('./geometry.mjs', import.meta.url), JS],
    ['/src/project.mjs', new URL('./project.mjs', import.meta.url), JS],
    ['/vendor/three/three.module.js', threeModule, JS],
    ['/vendor/three/three.core.js', new URL('./three.core.js', threeModule), JS],
    ['/vendor/three/addons/controls/OrbitControls.js', orbitControls, JS],
  ];
  const routes = new Map(await Promise.all(files.map(async ([route, file, type]) => [
    route, { body: await readFile(file), type },
  ])));
  routes.set('/project.json', { body: serializeProject(project), type: 'application/json; charset=utf-8' });
  return routes;
}

function reply(response, status, body, headers = {}) {
  response.writeHead(status, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  response.end(body);
}

function isLocalRequest(request) {
  const port = request.socket.localPort;
  const host = request.headers.host;
  if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return false;
  const fetchSite = request.headers['sec-fetch-site'];
  return fetchSite === undefined || fetchSite === 'none' || fetchSite === 'same-origin';
}

export async function startPreview(inputPath, { port = DEFAULT_PORT } = {}) {
  const project = await loadProject(inputPath);
  const routes = await previewRoutes(project);
  const server = createServer((request, response) => {
    if (!isLocalRequest(request)) {
      reply(response, 403, 'Open the preview from its local URL.');
      return;
    }
    if (request.method !== 'GET') {
      reply(response, 405, 'Method not allowed.', { Allow: 'GET' });
      return;
    }

    const route = routes.get(request.url);
    if (!route) {
      reply(response, 404, 'Not found.');
      return;
    }
    reply(response, 200, route.body, { 'Content-Type': route.type });
  });
  server.listen({ host: HOST, port });
  await once(server, 'listening');
  return { server, url: `http://${HOST}:${server.address().port}` };
}
