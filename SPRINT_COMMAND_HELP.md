# Sprint Command Help

Sprint Command Center manages tmux-backed coding sessions for Claude Code, GitHub Copilot, Gemini CLI, and custom tools.

## Startup Rules

- Read the project `CLAUDE.md` file when it exists.
- Read `/Volumes/Extreme Pro/.gstack/orchestrator.md` for the sprint workflow.
- Read the current sprint `.sprints/<feature>/STATE.json` file before acting.
- Read `.sprints/<feature>/ATOMS.md` when it exists.

## Tool-Neutral Workflow

Some CLIs do not support Claude-style slash commands directly. In Sprint Command Center, treat these commands as workflow names:

- `/office-hours`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/review`
- `/qa`
- `/qa-only`
- `/ship`
- `/document-release`
- `/retro`
- `/investigate`
- `/browse`
- `/benchmark`
- `/canary`

If your CLI does not support a slash command, read the matching skill file from `/Volumes/Extreme Pro/.gstack/skills/<command-without-slash>/SKILL.md` and execute the workflow manually.

## Autonomy Rules

- Continue the workflow without waiting for manual approval on routine steps.
- Only stop when you truly need a human decision or missing information.
- When you need input, ask one concise question through the ask-user flow if available.
- Put the most likely or recommended option first.
- Once an answer arrives, continue automatically from there.

## Sprint Phases

- `PLAN -> BUILD -> REVIEW -> QA -> SHIP -> COMPLETE`
- If UI work exists, do not skip QA.
- When a phase changes, update `STATE.json` consistently.

## Session Behavior

- New sessions use the selected CLI tool.
- Existing sessions keep the tool they were created with.
- If a tmux session exits, Sprint Command Center should mark the terminal dead and return the UI to the board.
