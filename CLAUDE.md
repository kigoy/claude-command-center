# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

Sprint Command is the development workflow engine.

**ON EVERY SESSION START:** Read `/Volumes/Extreme Pro/.gstack/orchestrator.md`
and follow its Session Start instructions.

- Orchestrator: /Volumes/Extreme Pro/.gstack/orchestrator.md
- Skills: /Volumes/Extreme Pro/.gstack/skills/
- Sprint state: .sprints/ directory
- The orchestrator loads the right skill for the current phase.

## Post-Task

Create FOR_YOCHAI.md after significant work. Coffee-chat tone.

## Commands

```bash
# Development (runs backend + frontend concurrently)
npm run dev
# Backend: http://localhost:3100
# Frontend: http://localhost:5173 (proxies /api and /ws to backend)

# Production build
npm run build        # Builds frontend into frontend/dist
npm start            # Serves built frontend + API from one process

# Backend only (with file watching)
npm run dev:server

# Frontend only
cd frontend && npx vite
```

There are no tests or linters configured.

## Architecture

Web-based command center for managing Claude Code CLI sessions via tmux. Two separate npm projects share one repo:

**Backend** (`server/`) — Node.js + Express + TypeScript, run via `tsx`
- `index.ts` — Express app, mounts all routes, starts HTTP server + WebSocket
- `sessions.ts` — CRUD for tmux sessions (create/list/kill), syncs DB state with live tmux on startup
- `terminal.ts` — Dual transport for terminal I/O: WebSocket (primary) and SSE (fallback). Uses `node-pty` to spawn `tmux attach-session` processes. PTY instances are shared between transports via `activePtys` map
- `status.ts` — Polls tmux pane content every 3s, detects Claude's state (idle/running/waiting/dead) via regex on terminal output
- `db.ts` — SQLite via better-sqlite3, single `sessions` table, WAL mode. DB file: `command-center.db` at repo root
- `auth.ts` — Passphrase login, JWT (HS256 via jose), cookie-based auth. Protects `/api/*` routes + WebSocket upgrades

**Frontend** (`frontend/`) — React 19 + Vite + TypeScript
- Three pages: `Login`, `Dashboard` (session list), `Terminal` (xterm.js)
- Auth check via `ProtectedRoute` wrapper that calls `/api/auth/check`
- Vite dev server proxies `/api` and `/ws` to backend (port 3100)

**Key conventions:**
- tmux sessions are prefixed `cc-` (e.g., `cc-abc123`) — this prefix is used in `sessions.ts`, `terminal.ts`, and `status.ts`
- Session IDs are 10-char nanoid strings
- All server imports use `.js` extensions (required for ESM + tsx)
- No shared types package — `Session` type is defined in `db.ts` and used across server files
- Frontend and backend have separate `package.json`, `tsconfig.json`, and `node_modules`

## Code Style

- Write minimal, clean code. This project is open source — others will read and contribute to it.
- No machine-specific paths or configuration. Everything must be generic and portable.
- Keep files short and focused. Prefer clarity over cleverness.

## Common Errors to Avoid

- After modifying `server/` files, restart the server process — `npm run build` only rebuilds frontend static assets, not the running Express/tsx process
- `sessions.ts` reuses existing running sessions by name before creating new ones — never create duplicate `cc-*` tmux sessions for the same sprint
- Production mode: Express on `:3100` serves `frontend/dist`. Changes need `npm run build` + server restart. Vite dev server (`:5173`) is not used in production
