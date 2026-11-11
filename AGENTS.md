# HouseCraft Viewer

This repository is public. The viewer is account-free, supports one house per project and runs on localhost. Keep generated personal projects outside this repository. Never copy private planning, photographs, identifying home geometry, secrets or local paths into it.

Read README.md and docs/project-format.md before changes. Keep the CLI and browser on the same validation and geometry implementation. The runtime supports proxies and rejects GLB assets until they can be supported safely. Run `npm test` for code changes and browser checks for rendering or import changes. Update README.md, relevant contract docs and CHANGELOG.md at substantial checkpoints.

## Documentation checkpoints

After a substantial change (accepted plan/architecture decision, milestone, feature, fix or material verification result), update the relevant existing documentation and progress record automatically. Prefer updating a canonical document over creating a new note for every edit. Record what changed, why, checks run and remaining limits; never claim unrun checks.

At a coherent checkpoint, inspect the diff and unrelated changes, run appropriate checks, then prepare a concise proposed commit summary. Ask the user before committing. After an approved commit, ask separately before pushing. Never treat commit approval as push approval. Batch related changes into one reviewable checkpoint rather than asking for every file. If approval is pending, report the prepared state and stop before the gated operation.

Do not include secrets, local dependency folders, unrelated work or unreviewed personal assets. Public changes require a privacy/provenance review. Never force-push or alter repository visibility as part of a checkpoint. This is an agent-maintained workflow, not a background watcher; manual edits are reconciled when an agent next works in the repository.
