# CLI Tool Registry

Sprint Command Center stores launchable coding tools in SQLite instead of assuming a single Claude-only backend.

## Built-in tools

Built-ins are seeded on server startup if missing.

- `claude` -> `claude --permission-mode bypassPermissions`
- `copilot` -> `gh copilot -- --yolo`
- `gemini` -> `gemini --approval-mode yolo`

They can be edited and disabled from the app, but they are treated as first-class defaults for a multi-tool sprint workflow.

## What a tool definition controls

Each tool record defines:
- `id`
- `label`
- `command`
- `args`
- `sessionPrefix`
- `promptMode`
- `promptArgTemplate`
- `statusDetection`
- `env`
- `enabled`
- `sortOrder`

This lets Sprint Command handle both built-in tools and custom wrappers without hardcoding launch behavior in the UI.

## Session behavior

- Each session stores `tool_id`.
- Existing rows are backfilled to `tool_id = "claude"`.
- New sessions launch from the selected tool definition.
- Existing sessions keep the tool they were created with.
- Terminal headers and reopen flows use the stored tool when possible instead of assuming Claude semantics.
- If a tool definition is removed or disabled later, existing sessions still render with stored fallback metadata and fail cleanly on relaunch.

## Sprint behavior

- New sprint and Explore Idea launches write `tool_id` to sprint `STATE.json`.
- Reopening a sprint terminal reuses the stored tool id.
- Sprint launches send a tool-neutral bootstrap prompt that points every CLI to [`SPRINT_COMMAND_HELP.md`](../SPRINT_COMMAND_HELP.md), the gstack orchestrator, and any available project guidance.
- Sprint action commands such as `/review`, `/qa`, and `/ship` are converted into workflow prompts so non-Claude tools do not depend on native slash-command support.
- Copilot prompts lead with the slash command itself because command placement matters more there than with Claude.

## Project instruction sync

Before sprint launches, Sprint Command can copy a project's primary guidance file into:
- `GEMINI.md`
- `copilot-instructions.md`
- `.github/copilot-instructions.md`

Source priority:
1. `CLAUDE.md`
2. `AGENTS.md`

This keeps repo initialization coherent across tools without asking the user to maintain multiple nearly-identical instruction files by hand.

## Workflow questions

Autonomy is the default, but some workflows still need a human answer.

When a tool asks through the MCP ask-user flow:
- unresolved requests are stored server-side
- Mission Control polls `/api/mcp/requests`
- the frontend shows the current question in a modal
- the first option is treated as the recommended answer and gets a dedicated fast button
- responses are posted back through `/api/mcp/respond`

This keeps the interruption loop in the main dashboard instead of forcing the user into terminal transcripts or mobile notification links for every decision.

## Settings behavior

The Settings page now covers more than app preferences:
- CLI tool registry editing
- tool enable/disable state
- tool ordering
- project config editing
- group config editing
- project-path scanning under the configured workspace root

The goal is to keep Sprint Command operationally editable from the app, not from ad hoc YAML and code edits.

## Runtime notes

- tmux session names use each tool's `sessionPrefix`.
- Status detection can use tool-specific regex patterns when configured.
- When no tool-specific detection exists, the backend falls back to generic running/waiting/dead heuristics.
- Built-in autonomy flags reduce routine approval friction, but real workflow decisions should still flow through the frontend question UI.
