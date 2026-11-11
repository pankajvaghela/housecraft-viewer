import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadProject, startPreview } from '../src/server.mjs';

const fixtureDirectory = fileURLToPath(new URL('../examples/two-room/', import.meta.url));

function getResponse(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, ...options }, response => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('serves the validated project and exact app routes on loopback', async t => {
  const { server, url } = await startPreview(fixtureDirectory, { port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { address, port } = server.address();
  assert.equal(address, '127.0.0.1');
  assert.equal(url, `http://127.0.0.1:${port}`);

  const project = await getResponse(port, '/project.json');
  assert.equal(project.status, 200);
  assert.match(project.headers['content-type'], /application\/json/);
  assert.equal(project.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(project.body), await loadProject(join(fixtureDirectory, 'housecraft.json')));

  const routes = ['/', '/viewer/viewer.mjs', '/viewer/styles.css', '/src/geometry.mjs',
    '/src/project.mjs', '/vendor/three/three.module.js', '/vendor/three/three.core.js',
    '/vendor/three/addons/controls/OrbitControls.js'];
  for (const path of routes) {
    const { status, headers } = await getResponse(port, path);
    assert.equal(status, 200, path);
    assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(headers['cross-origin-resource-policy'], 'same-origin');
  }
});

test('rejects cross-origin access, write methods and paths outside the allowlist', async t => {
  const { server } = await startPreview(fixtureDirectory, { port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const denied = [
    ['/project.json', { headers: { Host: 'example.test' } }, 403],
    ['/project.json', { headers: { Origin: 'https://example.test' } }, 403],
    ['/project.json', { headers: { Origin: 'null' } }, 403],
    ['/project.json', { headers: { 'Sec-Fetch-Site': 'same-site' } }, 403],
    ['/project.json', { method: 'POST' }, 405],
    ['/housecraft.json', {}, 404],
    ['/package.json', {}, 404],
    ['/assets/model.glb', {}, 404],
    ['/viewer/../package.json', {}, 404],
    ['/viewer/%2e%2e/package.json', {}, 404],
    ['/project.json?file=secret.json', {}, 404],
  ];
  for (const [path, options, status] of denied) {
    assert.equal((await getResponse(port, path, options)).status, status, path);
  }
});

test('rejects an invalid file before listening and preserves its bytes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'housecraft-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'housecraft.json');
  const original = '{"version":2}';
  await writeFile(file, original);
  await assert.rejects(startPreview(directory, { port: 0 }), /version:.*unsupported/);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('rejects project files with invalid UTF-8', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'housecraft-encoding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'housecraft.json');
  await writeFile(file, Buffer.from([0xff]));
  await assert.rejects(loadProject(file), /UTF-8/);
});
