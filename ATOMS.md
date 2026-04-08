# ATOMS

Spec source: `/Users/ykorn/.copilot/session-state/3d2bd12c-5995-41fc-80ba-50772d9694cd/plan.md`

Scope: **reduced Slice 1 only**

Out of scope for these atoms:
- `explore-new-project`
- launch sets
- history
- retry / replay
- ownership metadata
- result-board re-launch for `created_without_session`
- full startup reconciliation across DB, filesystem, and tmux
- dismiss overlay while launch continues in background

## Atom 1: Batch State Contract + SQLite Schema
- **Scope:** Add first-class batch persistence for launch batches and launch rows, including lifecycle enums, indexes, and shared row/batch data shapes used by both backend and frontend.
- **Acceptance:** Batch and row records can be created, queried, and updated; state names match the cleared plan; schema supports persisted result-board reload; indexes cover recency and row status lookups.
- **Depends on:** nothing
- **Target files:** `server/db.ts`, `server/batch-store.ts` or equivalent, shared batch types module, `frontend/src/types.ts`
- **Size:** M
- **Parallelizable with:** Atom 6

## Atom 2: Parser + Preflight Engine
- **Scope:** Build the pure parsing and validation layer for Batch Create: one row per line, pipe-delimited teaching format, tab-paste support, 20-row cap, canonical normalization, row-kind validation, project/tool validation, collision reporting, and session label/prefix hints without fake final tmux ids.
- **Acceptance:** A single parser/preflight API can turn draft text into canonical row previews with `launchable` vs `blocked` outcomes and explicit inline reasons; no route code duplicates parsing logic.
- **Depends on:** Atom 1
- **Target files:** `server/batch-parse.ts`, `server/batch-preflight.ts`, `server/sprint-api.ts` or batch routes module, parser/validation tests
- **Size:** M
- **Parallelizable with:** Atom 6

## Atom 3: Batch Executor + Minimal Startup Sweep
- **Scope:** Add the launch runner for valid rows only, with persisted row transitions, partial-success behavior, sequential/controlled launch steps compatible with sync tmux/filesystem operations, and a minimal startup sweep that marks orphaned `queued` / `launching` rows as interrupted or recovery-needed.
- **Acceptance:** Valid rows launch and persist final states; invalid rows remain blocked; no retry/replay path is introduced; startup does not leave rows hanging forever after restart.
- **Depends on:** Atom 1, Atom 2
- **Target files:** `server/batch-runner.ts`, `server/sessions.ts`, `server/session-runtime.ts`, startup wiring in `server/index.ts`
- **Size:** L
- **Parallelizable with:** Atom 5

## Atom 4: Batch Routes + Dedicated Invalidation Channel
- **Scope:** Expose batch APIs and live state transport: `POST preflight`, `POST execute`, `GET batch by id`, and a dedicated batch-state invalidation stream or equivalent hook, plus polling-safe fetch semantics. Do **not** reuse `sprint-sse.ts` file watchers for batch row state.
- **Acceptance:** Frontend can preflight, execute, reload a persisted batch, and observe status changes through a dedicated batch-state channel with polling fallback support.
- **Depends on:** Atom 1, Atom 2, Atom 3
- **Target files:** `server/index.ts`, `server/sprint-api.ts` or new `server/batch-api.ts`, `server/batch-events.ts` or equivalent
- **Size:** M
- **Parallelizable with:** nothing

## Atom 5: Express App Export + Real Route Test Harness
- **Scope:** Refactor server boot so tests can import a configured Express app without binding a real listener, and establish the route-level test harness for batch endpoints using the real app rather than mirrored logic.
- **Acceptance:** Tests can hit real batch routes with Supertest/Vitest; `app.listen()` is isolated from test imports; no new batch route tests reimplement server behavior inside test files.
- **Depends on:** Atom 4
- **Target files:** `server/index.ts`, `server/app.ts` or equivalent, `tests/batch-api.test.ts`, test helpers
- **Size:** M
- **Parallelizable with:** Atom 6

## Atom 6: Mission Control Entry + Overlay Shell
- **Scope:** Add Batch Create as the primary top-level creation action, keep one-item sprint/idea flows as secondary shortcuts, and build the full-height Mission Control overlay shell with desktop/tablet/mobile layout structure only.
- **Acceptance:** Overlay opens from Mission Control, closes cleanly, matches the existing app shell, and supports the specified desktop `60 / 40 / 200px` layout plus mobile stepped shell.
- **Depends on:** Atom 1
- **Target files:** `frontend/src/components/MissionControl.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/components/BatchCreateOverlay.tsx`, related styles
- **Size:** M
- **Parallelizable with:** Atom 2, Atom 5

## Atom 7: Composer + Preflight Preview UI
- **Scope:** Build the draft input and review experience: multiline composer, empty-state teaching example, row cap warnings, explicit preflight action, read-only composer during authoritative preflight, dense structured preview rows, inline blocking reasons, and mobile Draft -> Review state preservation.
- **Acceptance:** User can paste pipe/tab rows, see canonical previews, understand blocked reasons without expanding, and move between Draft and Review without losing edits.
- **Depends on:** Atom 4, Atom 6
- **Target files:** `frontend/src/components/BatchCreateOverlay.tsx`, `frontend/src/components/BatchRowList.tsx`, `frontend/src/hooks/use-batch-create.ts` or equivalent, related styles
- **Size:** L
- **Parallelizable with:** nothing

## Atom 8: Launch Flow + Result Board UI
- **Scope:** Wire execute to the overlay and result board: exact counts, success/partial/failure summaries, severity-first row ordering, open-session actions for successful rows, reconnect messaging, polling fallback, no blank reload state, overlay stays open during active launch, and board highlight after completion.
- **Acceptance:** Launch stays visible until settled, reconnect does not produce infinite spinners or blank UI, result board reloads from persisted truth, and returning to Mission Control highlights the launched work.
- **Depends on:** Atom 4, Atom 6, Atom 7
- **Target files:** `frontend/src/components/BatchCreateOverlay.tsx`, `frontend/src/hooks/use-batch-launch.ts`, `frontend/src/hooks/use-terminals.ts`, `frontend/src/components/MissionControl.tsx`, related styles
- **Size:** L
- **Parallelizable with:** nothing

## Atom 9: Coverage + Accessibility Completion
- **Scope:** Finish the implementation with real tests and final interaction coverage: parser/preflight contract tests, execute/result-board route tests, reconnect/polling fallback tests, mobile stepped-flow coverage, focus return, keyboard path, and row-cap edge cases.
- **Acceptance:** New batch codepaths are covered by real route and UI tests; focus and keyboard behavior match the cleared plan; no mirrored-route tests are added for batch behavior.
- **Depends on:** Atom 5, Atom 7, Atom 8
- **Target files:** `tests/batch-api.test.ts`, frontend component/hook tests, accessibility-focused test files, any minimal support refactors needed
- **Size:** L
- **Parallelizable with:** nothing

## Dependency Graph

```text
Atom 1
  ├── Atom 2
  │     └── Atom 3
  │           └── Atom 4
  │                 ├── Atom 5
  │                 ├── Atom 7
  │                 │     └── Atom 8
  │                 │           └── Atom 9
  │                 └── Atom 8
  └── Atom 6
        ├── Atom 7
        └── Atom 8
```

## Parallelizable Atoms

- **Atom 1** and **Atom 6**
- **Atom 2** and **Atom 6**
- **Atom 5** can start once **Atom 4** stabilizes, while frontend work is finishing

## Suggested Execution Order

1. **Atom 1** — lock the state contract first
2. **Atom 2** + **Atom 6** in parallel
3. **Atom 3**
4. **Atom 4**
5. **Atom 5** + **Atom 7** in parallel
6. **Atom 8**
7. **Atom 9**

## Suggested Worktree Lanes

### Lane A: Backend contract
- Atom 1 -> Atom 2 -> Atom 3 -> Atom 4

### Lane B: Frontend shell
- Atom 6 -> Atom 7 -> Atom 8

### Lane C: Test harness
- Atom 5 -> Atom 9

Lane B should not merge before Atom 4 lands, because the overlay depends on real batch route and state contracts.
