# Sprint Command Center

Sprint Command Center is a tmux-backed control plane for running parallel software sprints across multiple projects and multiple coding CLIs.

It combines:
- a browser dashboard for sprint state, alerts, analytics, and terminal access
- a gstack-based workflow engine for PLAN -> BUILD -> REVIEW -> QA -> SHIP
- a tool registry for Claude Code, GitHub Copilot, Gemini CLI, and custom terminal tools
- a frontend approval/question loop so agents can keep moving until a real decision is required

## What it does

- Tracks projects from your gstack config and reads sprint state from each project's `.sprints/` directory
- Launches coding tools inside tmux and keeps those sessions durable across browser refreshes
- Lets you create sprints, explore ideas, archive finished work, delete dead ends, remix abandoned attempts, and review sprint health
- Surfaces sprint history, phase progress, stale/blocker alerts, and lightweight analytics in one board
- Stores per-session tool metadata in SQLite so reopening a terminal uses the right CLI, not just a Claude default
- Shows unresolved workflow questions directly in Mission Control with a recommended first answer

## Core concepts

### Projects

Projects come from `GSTACK_CONFIG` and can also be edited from the Settings page. Project/group configuration is stored in the gstack YAML, while runtime session metadata lives in SQLite.

### Sprints

Each sprint lives in a project's `.sprints/<feature>/` directory and is driven by:
- `STATE.json`
- `ATOMS.md` when present
- optional project guidance from `CLAUDE.md` or `AGENTS.md`

Sprint Command reads that state, renders it on the board, and drives workflow actions through tmux-backed CLI sessions.

### Tools

The app ships with built-in profiles for:
- Claude Code
- GitHub Copilot CLI
- Gemini CLI

You can also add custom CLI tools in Settings. Each tool defines:
- launch command and args
- session prefix
- prompt delivery mode
- optional status detection patterns
- optional environment variables

More detail: [docs/cli-tool-registry.md](docs/cli-tool-registry.md)

## Operator model

Sprint Command is designed to be autonomous by default:
- agents should continue the workflow without waiting for manual nudges
- only real decision points should interrupt execution
- when input is needed, the frontend shows the question and a recommended option first

That behavior is reinforced in [SPRINT_COMMAND_HELP.md](SPRINT_COMMAND_HELP.md), which is injected into sprint launches across tools.

## Main features

- Pipeline board across `PLAN`, `BUILD`, `REVIEW`, `QA`, `SHIP`, and `COMPLETE`
- Sprint actions that execute workflow commands in the backing terminal
- Sprint history feed combining lifecycle events, phase transitions, and action logs
- Sprint review report for structural validity, freshness, and workflow correctness
- Sprint remix flow that reopens the original creation path with prefilled defaults
- Destructive sprint deletion with tmux/session cleanup
- Frontend pending-question modal backed by unresolved MCP ask-user requests
- Tool picker and tool-aware tmux/session handling
- Settings for app config, project/group config, and CLI tool registry
- Alerts for stale and blocked sprints
- Retro, analytics, recommendation, and briefing endpoints for the dashboard

## Architecture

```text
Browser
  ├─ React + Vite Mission Control UI
  ├─ xterm.js terminal client
  └─ polling/SSE for dashboard, snippets, alerts, and pending questions

Node/Express server
  ├─ sprint API and workflow routes
  ├─ tmux launch / attach / cleanup
  ├─ session runtime abstraction for multiple CLI tools
  ├─ MCP ask-user response handling
  └─ SQLite persistence for sessions, tools, and local state

Project repos
  ├─ .sprints/<feature>/STATE.json
  ├─ .sprints/<feature>/ATOMS.md
  ├─ CLAUDE.md / AGENTS.md
  └─ backfilled GEMINI.md / copilot-instructions.md when needed
```

## Requirements

- Node.js 20+
- `tmux`
- one or more installed coding CLIs
  - `claude`
  - `gh copilot`
  - `gemini`
- a gstack config file
- optional `ntfy` setup for mobile notifications

## Setup

```bash
git clone <repo>
cd sprint-command-center
npm install
cd frontend && npm install && cd ..
cp .env.example .env
```

Important environment variables from [.env.example](.env.example):

| Variable | Purpose |
|---|---|
| `PORT` | HTTP server port |
| `AUTH_PASSPHRASE` | login passphrase |
| `AUTH_SECRET` | cookie signing secret |
| `COOKIE_MAX_AGE_HOURS` | auth session duration |
| `GSTACK_CONFIG` | path to your gstack `config.yaml` |
| `NTFY_*` | optional push notification settings |
| `BASE_URL` | absolute app URL for notifications and links |

## Running

### Development

```bash
npm run dev
```

This starts:
- backend on `http://localhost:3100`
- frontend dev server on `http://localhost:5173`

### Production

```bash
npm run build
npm start
```

### pm2

```bash
npm run pm2:start
```

Useful helpers:
- `npm run pm2:logs`
- `npm run pm2:restart`
- `npm run pm2:stop`

## Typical workflow

1. Open the dashboard and log in.
2. Confirm your projects and groups in Settings, or use the scan flow to discover candidates.
3. Start a sprint or run Explore Idea, selecting the CLI tool you want to use.
4. Let the agent execute the workflow in tmux.
5. Use board actions for review/qa/ship/archive, or open the terminal when you need direct control.
6. If the workflow truly needs input, answer it from the frontend question modal.

## Project guidance sync

If a project has `CLAUDE.md` or `AGENTS.md`, Sprint Command can backfill:
- `GEMINI.md`
- `copilot-instructions.md`
- `.github/copilot-instructions.md`

That keeps tool initialization consistent across CLIs instead of depending on Claude-only repo conventions.

## Notifications

Optional `ntfy` support can push alerts when the agent needs your attention.

Setup:

```bash
./scripts/setup-mcp.sh
./scripts/setup-hooks.sh
```

With the newer frontend question loop, attention requests can show up both as notifications and directly in Mission Control.

## Related docs

- [docs/cli-tool-registry.md](docs/cli-tool-registry.md)
- [SPRINT_COMMAND_HELP.md](SPRINT_COMMAND_HELP.md)
- [CHANGELOG.md](CHANGELOG.md)
- [FOR_YOCHAI.md](FOR_YOCHAI.md)
