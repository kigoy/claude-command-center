# AGENTS.md

## Repo Layout
- `server/`: Express API, tmux/session runtime, sprint orchestration, batch workflows, persistence.
- `frontend/src/`: React UI for Mission Control, board, dialogs, settings, and terminal surfaces.
- `mcp-server/`: standalone MCP notification and ask-user bridge package.
- `tests/`: Vitest and Supertest coverage with fixture-backed sprint/project state.
- `scripts/`: local dev helpers, notification hooks, and setup scripts.
- `docs/`: active product docs and screenshots.
- `archive/`: archived planning or legacy material that should not stay in the active root.

## Build And Test
- Backend typecheck: `npx tsc --noEmit`
- Frontend build: `npm run build`
- MCP build: `npm run build:mcp`
- Test suite: `npm test`
- Dev server: `npm run dev`

## Refactoring Rules
- Prefer small, reviewable batches over large rewrites.
- Preserve external behavior unless the batch explicitly changes behavior.
- Keep the repo runnable after each batch.
- Move files only when the destination structure is clearly better.
- Update imports, docs, and paths in the same batch as any file move.
- Archive superseded material instead of deleting it when provenance matters.

## Review Checklist
- Is the batch cohesive and reversible?
- Are tests or validations updated where behavior or structure changed?
- Are imports, paths, and docs still correct after moves?
- Did we avoid mixing mechanical cleanup with behavioral change unless required?
- Did we leave the repository easier to navigate than before?

## Archive Policy
- One-off planning artifacts, superseded docs, and legacy surfaces go under `archive/`.
- Use dated subfolders when that makes provenance clearer.
- Add a short README in each archive folder explaining what moved and why.
- Do not archive active runtime guidance such as `README.md`, `CHANGELOG.md`, or `SPRINT_COMMAND_HELP.md`.

## Commit Expectations
- Use conventional commit messages.
- Stage only the intended files for the current batch.
- Run validation that matches the change scope before commit.
- Review the diff before every commit and fix obvious issues first.
