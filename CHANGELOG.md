# Changelog

All notable changes to Sprint Command Center.

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
