# Changelog

All notable changes to Sprint Command Center.

## [1.0.2.0] - 2026-04-08

### Added
- Keyboard navigation for pipeline board (Arrow keys, Enter, Esc, Tab)
- Sprint timeline bars showing phase duration history on card expand
- In-browser alert banner for stale (>4h idle) and blocked sprints with dismiss/persist
- Settings page with theme toggle (dark/light), notification preferences, and server config
- Sprint archival for COMPLETE sprints (archive button, show/hide toggle)
- Board filters by project and health status (on_track/stale/blocked)
- Ship counter in sidebar showing sprints completed this week and all-time
- Confetti animation on sprint completion
- Mobile responsive layout with bottom nav at 480px breakpoint
- Light theme via CSS custom properties
- Alerts API endpoint (GET /api/alerts) detecting stale and blocked sprints
- Settings API endpoints (GET/PATCH /api/settings) with secret key protection
- Archive API endpoint (POST /api/sprints/:id/:feat/archive)

## [1.0.1.0] - 2026-04-08

### Added
- Pipeline board view with kanban-style columns (PLAN → BUILD → REVIEW → QA → SHIP → COMPLETE)
- Board cards with sprint health indicators (on_track/stale/blocked), atom progress rings, and time-in-phase tracking
- Terminal snippet previews on board cards showing last 3 lines from active tmux sessions via SSE
- Sprint action buttons on board cards that send skill commands (/review, /qa, /ship) to tmux terminals and advance sprint phase
- Two-click ship confirmation to prevent accidental deployments
- Command palette (Cmd+K) for quick sprint search and command execution
- Sprint health utilities (getHealth, timeAgo, nextAction, getProjectColor)
- Test coverage for sprint health utilities (16 test cases)

### Fixed
- Shell injection pattern in terminal snippet capture replaced with execFileSync array args
- TypeScript type assertions in terminal SSE and input handlers
