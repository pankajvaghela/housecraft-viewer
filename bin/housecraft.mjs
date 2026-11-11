#!/usr/bin/env node
import { loadProject, startPreview } from '../src/server.mjs';

const usage = [
  'Usage:',
  '  node bin/housecraft.mjs validate <project-dir-or-json>',
  '  node bin/housecraft.mjs preview <project-dir-or-json> [--port N]',
].join('\n');

async function run([command, projectPath, ...options]) {
  if (command === '--help' && projectPath === undefined) {
    console.log(usage);
    return;
  }

  if (command === 'validate' && projectPath && options.length === 0) {
    await loadProject(projectPath);
    console.log('Valid HouseCraft project.');
    return;
  }

  if (command === 'preview' && projectPath) {
    let port;
    if (options.length > 0) {
      const [flag, value] = options;
      if (options.length !== 2 || flag !== '--port' || !/^\d+$/.test(value) || Number(value) > 65535) {
        throw new Error('Expected --port followed by an integer from 0 to 65535.');
      }
      port = Number(value);
    }
    const { url } = await startPreview(projectPath, { port });
    console.log(`HouseCraft preview at ${url}`);
    return;
  }

  throw new Error(usage);
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
