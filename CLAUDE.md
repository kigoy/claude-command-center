# CLAUDE.md

This repository is Sprint Command Center, a sprint-first command center for running tmux-backed coding workflows across Claude Code, GitHub Copilot, Gemini CLI, and custom tools.

## Workflow

Sprint Command is the development workflow engine.

On every session start:
- read `/Volumes/Extreme Pro/.gstack/orchestrator.md`
- follow its Session Start instructions (detect project, ask what to work on)

Primary paths:
- Orchestrator: `/Volumes/Extreme Pro/.gstack/orchestrator.md`
- Skills: `/Volumes/Extreme Pro/.gstack/skills/`
- Load skills on demand by name. No sprint state is tracked.

Do not invent a parallel workflow.

## Post-task

After significant work, update `FOR_YOCHAI.md` in a coffee-chat tone.

## Commands

```bash
# Development
npm run dev

# Backend only
npm run dev:server

# Production build + run
npm run build
npm start

# Verification
npm test
npx tsc --noEmit

# pm2 helpers
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
npm run pm2:stop
```

## Product model

Sprint Command Center is not just a terminal wrapper.

It manages:
- projects loaded from gstack config
- sprint state from `.sprints/<feature>/STATE.json`
- optional sprint atoms from `ATOMS.md`
- tool-specific tmux launches
- workflow commands such as `/review`, `/qa`, and `/ship`
- frontend question handling for real decision points

## Architecture

### Backend

`server/index.ts`
- boots Express
- wires auth, sessions, CLI tool APIs, MCP question endpoints, and sprint routes
- serves the built frontend in production

`server/sprint-api.ts`
- primary sprint dashboard API
- project config, groups, scan, create sprint, explore idea
- sprint detail, history, review, transition, archive, delete, remix, retro, analytics

`server/sessions.ts`
- session CRUD and tmux-backed launch behavior
- stores per-session `tool_id`

`server/session-runtime.ts`
- tool-aware launch abstraction for multiple CLIs

`server/cli-tools.ts`
- SQLite-backed CLI tool registry
- built-in tools: Claude, Copilot, Gemini

`server/project-instructions.ts`
- backfills `GEMINI.md`, `copilot-instructions.md`, and `.github/copilot-instructions.md`
- uses `CLAUDE.md` or `AGENTS.md` as the source of truth

`server/mcp-responses.ts`
- ask-user request store used by the frontend question loop

`server/db.ts`
- SQLite metadata store
- sessions table plus CLI tool registry

### Frontend

`frontend/src/components/MissionControl.tsx`
- top-level dashboard shell
- board, analytics, settings, terminals, action toasts, and pending workflow questions

`frontend/src/components/PipelineBoard.tsx`
- sprint board by phase

`frontend/src/components/PendingQuestionsPanel.tsx`
- modal for unresolved workflow questions
- recommended option is the first choice

`frontend/src/components/SettingsPage.tsx`
- app settings, tool registry, and sprint config surfaces

### Persistent state

- Runtime metadata: `command-center.db`
- Sprint state: `.sprints/<feature>/STATE.json`
- Sprint atoms: `.sprints/<feature>/ATOMS.md`
- Project config: `GSTACK_CONFIG`

## Tool behavior

- New sessions and new sprints launch with the selected CLI tool
- Existing sessions keep their stored `tool_id`
- Built-in defaults are autonomy-oriented:
  - Claude: `--permission-mode bypassPermissions`
  - Copilot: `--yolo`
  - Gemini: `--approval-mode yolo`
- If a tool cannot execute slash commands natively, Sprint Command translates the workflow into tool-neutral prompts

## Autonomy rules

- Continue the workflow by default
- Only stop when a human decision is actually required
- Put the most likely or recommended answer first when asking for input
- Prefer surfacing questions through the frontend ask-user flow instead of burying them in terminal output

## Verification expectations

Before finishing meaningful work, run:
- `npm test`
- `npx tsc --noEmit`

Run `npm run build` when frontend or packaging changes matter.
