# Archived Frontend Surfaces

This folder preserves frontend files that were no longer reachable from the
live application after Mission Control became the only authenticated app shell.

Moved on 2026-04-09 during repository maintenance to keep active frontend paths
focused on the current shell while retaining the superseded implementations for
historical reference.

Contents:
- `pages/Dashboard.tsx`: legacy session dashboard route
- `pages/Terminal.tsx`: legacy full-screen terminal route
- `components/SprintDashboard.tsx`: pre-Mission Control sprint dashboard shell
- `components/SessionCard.tsx`: card UI only used by the legacy session dashboard
- `components/MobileToolbar.tsx`: mobile terminal toolbar used only by the legacy terminal route
