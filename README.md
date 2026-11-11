<h1 align="center">HouseCraft Viewer</h1>
<p align="center">Explore your home in 3D and compare renovation ideas in your browser.</p>
<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="Local-first" src="https://img.shields.io/badge/workflow-local--first-277c70">
  <img alt="Node.js 22 or later" src="https://img.shields.io/badge/Node.js-22%2B-43853d">
</p>

HouseCraft Viewer is the local companion runtime for the [HouseCraft Plugin](https://github.com/pankajvaghela/housecraft-plugin). Your coding agent sets up this viewer, creates and validates your project, and opens a localhost preview. Start with the plugin for the agent-driven workflow.

Open one home project and switch between its existing layout and renovation variants. The viewer runs on your computer without a HouseCraft account. It supports single-level homes and displays furniture as labeled boxes sized to your project dimensions.

## Run the viewer manually

Use these commands to try the example, develop the viewer or troubleshoot an agent setup. You’ll need Git, Node.js 22 or later, npm and a browser with WebGL support.

```sh
git clone --branch v0.1.0 https://github.com/pankajvaghela/housecraft-viewer.git
cd housecraft-viewer
npm ci
node bin/housecraft.mjs validate examples/two-room
node bin/housecraft.mjs preview examples/two-room
```

Open the URL printed by the preview command, usually `http://127.0.0.1:4173`. Press Ctrl+C to stop the server. Use `--port 0` to pick an available port or `--port 4174` to set one.

## Explore and save

1. Orbit, pan and zoom to inspect rooms, walls and openings. Use **House version** to compare the existing layout with a renovation variant.
2. Open **Measurements and assumptions** to review dimension sources and estimates.
3. Use **Open project** to load a HouseCraft JSON file. Click **Download JSON** before closing the browser to save a copy with all house versions. The viewer keeps imported projects in the browser session and leaves your original file intact.

## Use your own project

For manual edits, start with the [two-room example](examples/two-room/housecraft.json) and follow the [project format](docs/project-format.md).

Keep your home project outside the viewer checkout. Pass its directory or JSON file to the CLI.

```sh
node bin/housecraft.mjs validate ../my-home/housecraft.json
node bin/housecraft.mjs preview ../my-home/housecraft.json
```

Restart the preview or reopen the JSON in the browser after editing the file.

## Development

Run `npm test` to check validation, geometry and the local preview server. The built-in viewer does not load community viewer plugins yet. [Open an issue](https://github.com/pankajvaghela/housecraft-viewer/issues) to discuss improvements. See the [changelog](CHANGELOG.md) for release notes.

## License

HouseCraft Viewer and its Three.js dependency use the MIT license. See [LICENSE](LICENSE).
