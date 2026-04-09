# For Yochai

## 1. Approach

I treated this as a workflow memory problem.

`Remix` only makes sense if Sprint Command remembers how a sprint was born. So the fix was:
- store origin metadata in `STATE.json`
- add a backend remix route that reads that metadata, deletes the sprint, and returns the right dialog defaults
- reopen either `Explore Idea` or `New Sprint` prefilled on the frontend

## 2. Rejected alternatives

I did not try to reconstruct remix state from filenames alone. That would work for `feat-x` but not for explore-idea descriptions, project-vs-group mode, or future workflow variants.

I also did not make the frontend guess which dialog to open. Backend owns the truth here.

## 3. Connections

The interesting connection is that sprint creation and sprint deletion are now part of the same lifecycle:
- `server/sprint-api.ts` writes origin metadata when a sprint is created
- `server/sprint-remix.ts` turns that metadata into a dialog payload
- `server/sprint-cleanup.ts` kills tmux + removes the sprint folder
- `MissionControl` reopens the original creation flow with the same prompt

So remix is not "clone sprint". It is "throw away this take, reopen the same creative move."

## 4. Tools

Used:
- repo trace through sprint creation, explore-idea flow, and dashboard actions
- `vitest`
- `tsc --noEmit`
- `npm run dev` at the end

## 5. Tradeoffs

For explore-idea sprints that originally created a brand new project, remix now reopens `Explore Idea` in `existing project` mode. That is deliberate. Reopening in `new project` mode would collide with the already-created project directory unless we also deleted the whole project, which is too destructive for a remix action.

## 6. Mistakes

The original product model treated sprint creation as one-way. Fine for a task tracker, wrong for an idea tool. People restart ideas. The product should admit that.

## 7. Pitfalls

Old sprints created before this metadata exists will remix as `New Sprint` by fallback. That is safe, but not as rich as the new path.

Also, remix is destructive. It deletes the sprint first, then opens the dialog. That matches the requested behavior, but it does mean the confirm copy matters a lot.

## 8. Expert insights

There are two kinds of "retry" in workflow products:
- retry execution
- retry framing

This feature is the second one. That means you do not want to reopen the same terminal session. You want to reopen the same setup context. Small difference in words, huge difference in user feeling.

## 9. Transferable lessons

If a workflow starts from a form, store the form intent with the artifact it creates.

That gives you:
- remix
- replay
- audit trail
- better migrations later

Without that metadata, every future lifecycle feature turns into archaeology.

---

## Sprint Review follow-up

### 1. Approach

I added a lightweight `Review sprint` action instead of inventing a new screen.

The backend now runs a sanity review over the sprint state and returns:
- whether the sprint still looks valid
- whether it appears to have actually started
- whether the stored state is internally consistent

The frontend just opens that report in the existing modal pattern.

### 2. Rejected alternatives

I did not make this a fuzzy AI judgment. For this kind of workflow state, deterministic checks are better:
- invalid phase
- broken `phase_history`
- mismatched open phase vs current phase
- skipped QA when UI QA is required
- stale sprint warning

That keeps the button trustworthy.

### 3. Connections

This fits the existing lifecycle work:
- delete/remix handles bad sprints operationally
- review tells you whether a sprint is bad before you decide what to do

So now Sprint Command has a cleaner loop:
- inspect
- review
- remix or continue

### 4. Tools

Used:
- repo trace through sprint actions and API routes
- new pure helper tests in `tests/sprint-review.test.ts`
- `npm test`
- `npx tsc --noEmit`

### 5. Tradeoffs

`Started` is heuristic, not absolute truth.

I treated a sprint as started if any real signal exists:
- non-`PLAN` phase
- active tmux session
- atoms present
- history shows movement beyond the initial planning entry

That is pragmatic enough for dashboard review without pretending the system has perfect telemetry.

### 6. Mistakes

The easy mistake here would have been making "still valid" mean the same thing as "state correct." That would look precise but tell you nothing new.

So I separated them:
- `state_correct` = structure is coherent
- `still_valid` = structurally okay, but not obviously stale/abandoned

### 7. Pitfalls

This review is only as good as `STATE.json` plus tmux detection.

If someone manually edits sprint files or works outside the expected flow, the report will reflect that imperfectly. That is acceptable for a workflow dashboard, but worth remembering.

### 8. Expert insights

Workflow tools usually fail by assuming every artifact is truthful forever.

A sprint file is not truth. It is a claim. A review button is valuable because it re-checks whether the claim still makes sense.

### 9. Transferable lessons

Whenever you have a state machine in product code, add a human-readable review surface early.

It saves time later in:
- debugging
- support
- cleanup
- trust-building with users

---

## Cross-tool init + Copilot office-hours follow-up

### 1. Approach

I treated this as two separate failures:
- missing per-tool instruction files
- Copilot seeing `/office-hours` too late in the prompt

So I fixed both at the source:
- added a project-instruction sync helper that backfills Copilot and Gemini files from `CLAUDE.md` or `AGENTS.md`
- changed workflow prompt generation so Copilot gets the slash command on line 1

### 2. Rejected alternatives

I did not add a separate UI button for "run /init everywhere." That would make the user remember another maintenance action.

Better to normalize the repo automatically:
- on server startup
- when a project is added
- before sprint and explore launches

### 3. Connections

This connects repo hygiene with workflow execution.

If Sprint Command launches Copilot into a repo with no guidance file, Copilot starts by complaining about setup instead of doing the work. And if `/office-hours` is buried mid-prompt, Copilot drifts into "thinking about the command" instead of starting it.

So the real fix is not one prompt tweak. It is making the repo look initialized before the tool wakes up.

### 4. Tools

Used:
- new helper in `server/project-instructions.ts`
- prompt changes in `server/sprint-command-help.ts`
- startup and launch wiring in `server/index.ts` and `server/sprint-api.ts`
- tests
- live prompt verification after restarting dev

### 5. Tradeoffs

I copied the source guidance file as-is into:
- `GEMINI.md`
- `copilot-instructions.md`
- `.github/copilot-instructions.md`

That is intentionally simple. It keeps all tools aligned immediately, even if the wording still says `CLAUDE.md`. The bigger risk was drift, not cosmetic wording.

### 6. Mistakes

The earlier prompt already mentioned `/office-hours`, but that was not enough for Copilot. The command has to be structurally prominent, not merely present.

### 7. Pitfalls

This only auto-backfills when a source guidance file exists. If a repo has neither `CLAUDE.md` nor `AGENTS.md`, Sprint Command will not invent project guidance from nothing.

That is the right failure mode.

### 8. Expert insights

Agent tooling often fails from small positional details.

Humans read "the prompt contains `/office-hours`" and assume it is fine. The model often treats "first line imperative" very differently from "instruction mentioned later in a paragraph."

---

## Repository maintenance follow-up

### 1. Approach

I treated the repo cleanup as a sequence problem, not a beautification problem.

So I started with the lowest-risk structure work first:
- add a real `AGENTS.md`
- archive obvious root clutter
- archive unreachable frontend surfaces
- centralize duplicated sprint freshness logic
- split `server/app.ts` into route registrars

Each batch stayed runnable and got its own validation before commit.

### 2. Rejected alternatives

I did not do the tempting "big tidy-up" pass.

That would have mixed:
- file moves
- behavior changes
- dead code removal
- API reshaping

into one blob that would be hard to review and harder to roll back.

### 3. Connections

The useful connection was that repo organization and product correctness were already linked.

Example:
- stale sprint rules were duplicated across frontend visibility, tmux exposure, alert generation, and sprint review
- dead legacy frontend pages were still sitting in active source paths even though the app no longer routed to them
- `server/app.ts` had become a grab bag because route logic never got promoted into modules

So "cleanup" was actually removing drift pressure from real behavior.

---

## Nested project scan follow-up

### 1. Approach

I fixed this at the scanner, not in config data.

The bug was simple: project scan only looked one directory deep under `/Volumes/Extreme Pro`. So a real repo like `leelafy/Proof-outreach` never made it into candidates even though its `.git` marker existed.

The fix was:
- keep scanning top-level projects as before
- if a top-level folder is not itself a git repo, scan its direct children too
- preserve the parent folder as an inferred `group`
- normalize mixed-case child names like `Proof-outreach` into `proof-outreach`

### 2. Rejected alternatives

I did not hardcode special handling for `leelafy`.

I also did not change the persisted config format. This is discovery logic, so the right place to fix it is candidate generation.

### 3. Connections

This connected three surfaces that were slightly out of sync:
- backend candidate scan
- frontend scan results UI
- project creation flow

Before the patch, even if the backend found a nested project later, the UI would not carry the inferred group into `Add Project`. Now the scan result includes `group`, shows it, and passes it through on add.

### 4. Tools

Used:
- repo trace in `server/sprint-config.ts`
- targeted frontend wiring in `SprintConfigSettings`
- `vitest`
- `npm run build`
- direct live scan verification against `/Volumes/Extreme Pro`

### 5. Tradeoffs

I kept the nested walk to one extra level only.

That is enough for the current `/Volumes/Extreme Pro/{group}/{repo}` layout and avoids turning project scan into an open-ended recursive crawl.

### 6. Mistakes

The original scan logic conflated "top-level folder" with "project root." That works until teams start grouping repos under umbrella folders, which is exactly what happened here.

### 7. Pitfalls

If someone nests repos deeper than two levels, they still will not show up. That is deliberate for now.

Also, if the server process is already running, this fix only appears after restart or reload because the code path lives in the backend process.

### 8. Expert insights

Repo detection should treat `.git` as a marker, not assume it is always a directory.

Worktrees and some repo setups use a `.git` file, and scanners that only think in terms of `.git/` directories quietly miss valid repositories.

### 9. Transferable lessons

When discovery UIs feel "random," check the traversal boundary first.

A shallow scan bug often looks like bad state, bad config, or bad caching from the user side, but the real issue is usually just one missing directory level.

### 4. Tools

Used:
- repo-wide search with `rg`
- targeted `tsc` and frontend builds
- focused Vitest runs for the shared sprint-health logic
- git diff review before each commit

I also checked the full test suite and found an environment issue:
- `better-sqlite3` is built against the wrong Node ABI in this machine right now

### 5. Tradeoffs

I archived legacy material instead of deleting it when provenance mattered.

That means the repo is a little larger, but the active tree is cleaner and we still keep:
- old planning docs
- unreachable frontend surfaces
- an audit trail for why those things moved

### 6. Mistakes

The repo had already accumulated a few "harmless" leftovers that were not harmless anymore:
- tracked local-only `.claude/settings.json`
- root planning docs mixed with active entry docs
- dead routes and CSS living beside the real app

None of those break immediately. They just make every future change noisier.

### 7. Pitfalls

The main live pitfall now is environmental, not logical:
- full Vitest still fails until `better-sqlite3` is rebuilt for the current Node version

Also, the next big batch is `server/sprint-api.ts`, and that one needs discipline. It is large enough that a rushed split would create subtle regressions.

### 8. Expert insights

There is a difference between "code that is unused" and "code that is unreachable."

Unreachable code is more dangerous in product repos because people keep mentally budgeting for it. They assume it might still matter, so it taxes navigation and slows confident edits.

Archiving unreachable surfaces is one of the fastest ways to make a repo feel smaller without lying about history.

### 9. Transferable lessons

When a repo starts feeling sticky, do the first maintenance wave in this order:
- clarify repo rules
- archive non-active material
- centralize duplicated decision logic
- turn giant assembly files into assemblers again

That order gives you cleaner future refactors without forcing a rewrite.

---

## Terminal Auto-Answer follow-up

### 1. Approach

I split the automation problem into two channels:
- MCP ask-user prompts already had an API path
- tmux-only prompts had no backend loop watching them

So I added a small tmux watcher in `server/sprint-terminal-auto.ts` that:
- scans active sprint tmux sessions
- checks whether the sprint is in `automation.mode = recommended`
- detects the terminal chooser UI
- presses the recommended default selection
- logs that auto-answer into sprint activity history

### 2. Rejected alternatives

I did not build a generic terminal AI autopilot that tries to answer arbitrary free-text questions. That would create fabricated product answers and make the workflow less trustworthy.

I also did not couple this to the frontend. The backend needs to keep automation moving even when no browser tab is open.

### 3. Connections

This closes the gap between:
- `/api/mcp/requests` prompts
- terminal-only prompt boxes inside tmux

Before this, `Auto It` looked enabled but still stalled whenever the skill asked inside the terminal UI. Now the same sprint can move through both prompt channels with one automation setting.

### 4. Tools

Used:
- existing tmux detection in `server/tmux-detect.ts`
- sprint state/history helpers
- `npx tsc --noEmit`
- live tmux capture against the active sprint sessions

### 5. Tradeoffs

The watcher is intentionally narrow. It only handles menu-style prompts where the recommended answer is already selected as option 1.

That means it will not answer:
- free-text questions
- shells sitting at a plain prompt
- arbitrary terminal output that merely happens to contain numbered text

### 6. Mistakes

The first matcher only handled the boxed `Asking user` UI. `.gstack` also emits a second menu layout without that marker, so I widened the matcher after checking the real panes.

### 7. Pitfalls

This does not solve two real remaining blockers:
- office-hours free-text questions still need a substantive answer
- some `.gstack` sessions are hitting Claude usage exhaustion, which no local watcher can bypass

So "recommended automation" is now materially better, but not yet fully unattended from start to finish.

### 8. Expert insights

Workflow automation breaks at interface boundaries more often than at business logic boundaries.

The system already knew the right next command and already knew how to answer MCP prompts. What was missing was watching the one place where the agent could still ask a question outside the server's structured control plane.

### 9. Transferable lessons

If a workflow can ask for user input in more than one transport, automation is only as reliable as the least structured transport.

Treat terminal prompts, API prompts, modal prompts, and notification callbacks as one decision surface, or the user will keep experiencing "auto mode" that still needs babysitting.

### 9. Transferable lessons

For multi-agent toolchains:
- standardize the repo entry files
- keep one source of truth
- make critical workflow commands lead the prompt, not trail it

That avoids a lot of fake "tool reliability" problems that are really prompt-shape problems.

---

## Autonomy defaults + sprint history follow-up

### 1. Approach

I treated this as two product gaps:
- the CLIs were not consistently launched in autonomous approval mode
- Sprint Command showed current state well enough, but not a clear history of what actually happened

So I changed the built-in tool defaults and added a real per-sprint history feed.

### 2. Rejected alternatives

I did not bolt a separate "YOLO mode" toggle onto the UI first. That would still leave old sessions and default launches inconsistent.

Instead, I changed the built-in tool registry defaults so the system behavior is coherent by default:
- Claude uses bypass permissions
- Copilot uses yolo
- Gemini uses yolo approval mode

### 3. Connections

This closes a loop in the workflow:
- prompt launches are now more autonomous
- actions sent to a sprint are now recorded
- transitions are now recorded
- history is visible from the sprint menu

So Sprint Command is less of a static board and more of a traceable execution log.

### 4. Tools

Used:
- CLI help output from `claude`, `gh copilot -- --help`, and `gemini`
- tool registry updates in `server/cli-tools.ts`
- new sprint history helper in `server/sprint-history.ts`
- API + UI wiring
- tests
- dev restart

### 5. Tradeoffs

I only backfilled the new autonomy flags when a built-in tool still had the legacy default args. That avoids stomping on user-customized tool configs.

For history, I kept the first version lightweight:
- phase events
- implementation summaries
- explicit commands sent
- transition events

Not every possible UI interaction is logged yet, because that would create noise fast.

### 6. Mistakes

The earlier model assumed current phase plus timeline bars were enough. They are not. When something feels off, users want a human-readable answer to:
"what did we do, when, and what changed?"

### 7. Pitfalls

Deleted sprints still lose their local history because the sprint artifact is removed. If long-term auditability matters, that history should eventually be copied to a project-level store before deletion.

### 8. Expert insights

Autonomy settings are part of product UX, not just CLI config.

If one tool asks permission every time, another skips, and a third behaves differently per repo, users experience that as workflow instability even if each tool is technically "working."

### 9. Transferable lessons

For orchestration products:
- make default execution posture explicit
- record meaningful actions at the same layer that triggers them
- give users a readable history view before they ask for an audit log

That usually prevents a lot of "why did this sprint end up here?" confusion later.

---

## Frontend workflow questions follow-up

### 1. Approach

I treated this as a visibility gap, not a brand-new workflow system.

The app already had an ask-user path:
- backend request store
- response endpoint
- standalone `/respond/:requestId` page

But Sprint Command itself never surfaced those pending questions on the main board. So the fix was:
- add an authenticated list endpoint for unresolved requests
- poll it from Mission Control
- show a board-level question modal
- make the first option one-click as the recommended path

### 2. Rejected alternatives

I did not build a second question system just for sprints. That would split workflow decisions between:
- MCP ask-user prompts
- sprint-specific prompts

One queue is cleaner.

I also did not force auto-answering yet. You asked for frontend confirmation, so the product should stop visibly when a real decision is needed.

### 3. Connections

This connects directly to the autonomy goal.

If Sprint Command is supposed to run the workflow on its own, then the remaining human interruptions need to be:
- explicit
- visible
- fast to answer

Otherwise the system feels broken even if the agent is technically waiting in the background.

### 4. Tools

Used:
- existing MCP request store in `server/mcp-responses.ts`
- authenticated API wiring in `server/index.ts`
- Mission Control polling + modal UI
- `vitest`
- `tsc --noEmit`

### 5. Tradeoffs

This version surfaces pending questions globally in the frontend, but it does not yet convert every sprint phase gate into this mechanism automatically.

So:
- ask-user prompts from the workflow now show up properly
- generic manual sprint phase buttons still exist

That is the right first cut because it fixes the missing visibility without pretending the whole orchestrator is already autonomous.

### 6. Mistakes

The easy mistake would have been adding more buttons to the sprint cards.

That would improve control but not workflow. The problem was not “not enough buttons.” The problem was “the human cannot see the question the system is waiting on.”

### 7. Pitfalls

The request store is still in-memory.

So if the server restarts, pending frontend questions disappear. Fine for now, but not durable enough if Sprint Command becomes the actual long-running workflow controller.

### 8. Expert insights

Autonomous systems feel autonomous only when the interruption path is clean.

If a tool works 95% on its own but the 5% decision point is hidden in a terminal tab, the user experiences the whole system as unreliable.

### 9. Transferable lessons

For orchestration products:
- centralize human decisions
- treat “waiting for input” as first-class state
- make the recommended path a single click

That turns interruptions into approvals instead of archaeology.

---

## Docs + release sync follow-up

### 1. Approach

I treated the docs as product surface, not decoration.

The README was still describing the older Claude-only command center, so I rewrote it around what the repo now actually is:
- sprint-first workflow engine
- multi-tool runtime
- tmux-backed execution
- frontend question handling for real decision points

### 2. Rejected alternatives

I did not do a cosmetic README patch.

That would leave the core mismatch intact: someone reading the docs would expect a browser terminal for Claude sessions, not a sprint orchestration system with review/remix/history/tool registry flows.

### 3. Connections

The documentation now lines up with the code changes across a few layers:
- README explains the product model
- `docs/cli-tool-registry.md` explains tool/runtime behavior
- `SPRINT_COMMAND_HELP.md` now tells launched agents to stay autonomous and only escalate real questions
- `CHANGELOG.md` records the new release surface

### 4. Tools

Used:
- repo diff scan
- route scan for server APIs
- targeted reads of sprint/runtime helpers
- doc rewrite via patch

### 5. Tradeoffs

I kept the README high-signal instead of trying to enumerate every endpoint and widget.

The right split is:
- README for operator understanding
- focused docs for subsystems
- changelog for release deltas

### 6. Mistakes

The package metadata had drifted from the changelog/version story. I aligned that as part of the release sync instead of pretending docs and versioning are separate concerns.

### 7. Pitfalls

The main doc risk in systems like this is stale specificity.

If screenshots or old step-by-step flows are not actively maintained, they become liabilities fast. So I preferred accurate narrative docs over preserving legacy screenshot-driven sections.

### 8. Expert insights

Workflow products need docs that explain control flow, not just setup commands.

In this repo, the important thing is not merely "how to run npm start." It is:
- where sprint truth lives
- how tools are selected
- when humans get interrupted
- what keeps behavior consistent across CLIs

### 9. Transferable lessons

When a product shifts from "single-tool utility" to "workflow platform," rewrite the docs from first principles.

Incremental wording tweaks are usually not enough. The mental model itself has changed.

---

## Full recommended-path automation follow-up

### 1. Approach

I treated your request literally: if you choose the recommended path, Sprint Command should stop making you babysit the workflow.

So the implementation now does three connected things:
- gives each sprint a persisted automation mode
- lets the frontend turn one recommended answer into `Use recommended + Auto It`
- makes the backend auto-accept later recommended answers for that same sprint and finish with `/retro`

### 2. Rejected alternatives

I did not make `Auto It` a fake phase-jump button.

That would look fast on the board but break the actual workflow truth. The right model is:
- enable automation
- send the real next command
- let the CLI session drive the real state transitions

### 3. Connections

This ties together pieces that were already half-built:
- the pending-question loop already knew what the recommended answer was
- sprint actions already knew the next workflow command
- SSE already watched sprint phase changes

Now those parts cooperate instead of acting like separate features.

### 4. Tools

Used:
- repo trace through sprint routes, MCP request flow, tmux launch path, and board actions
- new server helpers for automation state and sprint command execution
- frontend updates in Mission Control, cards, and question modal
- `vitest`
- `npx tsc --noEmit`
- `npm run build`

### 5. Tradeoffs

I scoped automation to the recommended path only.

That means the system is aggressive where we have a concrete default, but it does not hallucinate custom judgment for free-text questions or ambiguous branches. It is a strong default without pretending to be omniscient.

### 6. Mistakes

The easy wrong move here was to wire `Auto It` only into the frontend button copy and leave the backend stateless. That would work for one click, then fail on the next real question.

The fix had to be end-to-end:
- sprint state
- launch env
- MCP payload
- server-side auto response
- retro chaining

### 7. Pitfalls

Old sprint `STATE.json` files will not have automation metadata until touched. That is fine because the code treats missing automation as manual mode.

Also, `Auto It` only auto-answers when the prompt actually includes options and the first option is the recommended one. That is intentional. The recommendation contract stays explicit.

### 8. Expert insights

Workflow automation products often fail because they automate the obvious clicks, not the decision loop.

The real unlock is not "one more shortcut button." It is preserving enough context that when the next interruption appears, the system knows whether to stop or keep going.

### 9. Transferable lessons

If you want trustworthy autonomy, persist operator intent as state, not as UI mood.

`Auto It` works because the sprint now remembers:
- this run is in recommended mode
- which project and feature a question belongs to
- whether retro already fired

That pattern generalizes well beyond this app.

---

## Batch Create — full atom build

### 1. Approach

I built the entire Batch Create feature as 9 atoms, each a self-contained slice committed to its own branch. Two parallel lanes (backend: atoms 1→2→3→4, frontend: 6→7) converged at atom 8 (launch flow + result board), with atom 5 as a test harness spur and atom 9 closing the coverage gap.

### 2. What shipped

- **Batch state contract** — SQLite schema for launch batches and rows, shared types between server and frontend
- **Parser + preflight** — pipe/tab parsing, 20-row cap, project/tool/collision validation, pure functions
- **Executor** — sequential launcher with partial-success, orphan recovery on restart
- **Routes** — POST preflight, POST execute, GET batch, dedicated SSE invalidation channel
- **Test harness** — Express app export via `createApp()`, Supertest-based route tests
- **Overlay shell** — full-height Mission Control overlay with desktop/mobile layout
- **Composer + preview** — multiline draft, teaching example, read-only preflight review
- **Launch flow + result board** — SSE live updates with polling fallback, severity-first row sorting, open-session actions, board highlight on close
- **Coverage** — 188 tests (up from 132), including store CRUD, parser edge cases, route contracts

### 3. Architecture decisions

The design is intentionally reconnect-safe: `GET /api/batches/:id` is always the source of truth. SSE only nudges the client to refetch. The overlay never blanks on reconnect — stale data stays visible while polling catches up.

The overlay stays open and blocks close during active launch. When it finally closes, it passes created rows back to Mission Control as a `BatchClosePayload` so the board can highlight the launched work.

### 4. Tradeoffs

No frontend component tests yet — the repo has no jsdom/react-testing-library setup. All new test coverage is backend (route + unit). That is the right priority for Slice 1.

The execute route tests can only verify blocked-row paths (422) because launching real tmux sessions in CI is not practical. The runner unit tests cover the execution logic with injected deps.

### 5. Numbers

- 9 atoms, 9 branches, 9 worktrees
- ~2,400 lines of new code across server and frontend
- 188 tests passing, typecheck clean, frontend build succeeds
- Atom 9 branch (`atom/9-coverage`) has the full merged tree

---

## Dashboard freshness follow-up

### 1. Approach

I treated this as a data-quality bug, not a frontend rendering bug.

The board was stale for two specific reasons:
- `last_activity` only looked at `phase_history`, so active automation looked old
- recommendations still ranked archived sprints

So the fix lives in the summary builder:
- compute `last_activity` from the newest valid timestamp across `created`, `phase_history`, and `activity_history`
- exclude archived sprints before calling the recommendation engine

### 2. Rejected alternatives

I did not patch this in the client by hiding archived recommendations after the fact. That would leave the API wrong and any other consumer would still get stale ranking data.

I also did not special-case tmux-active sessions into `last_activity`. The sprint file should remain the canonical product timeline; tmux liveness is separate runtime telemetry.

### 3. Connections

This ties directly into the Auto It work.

Once automation started appending `activity_history`, the dashboard should have started treating those entries as the freshest signal. It did not, so the board looked "stale" even while the workflows were moving.

### 4. Tools

Used:
- live `/api/dashboard` verification
- targeted regression test in `tests/sprint-api.test.ts`
- `npx tsc --noEmit`

### 5. Tradeoffs

Archived sprints still appear in project sprint lists, because that is useful history. They are only excluded from recommendation ranking.

That keeps the board honest without erasing archive visibility.

### 6. Mistakes

The subtle mistake was assuming phase transitions are the only meaningful work signal.

For automated workflows, plenty of important progress happens before a phase changes: commands sent, recommended answers accepted, retries, relaunches.

### 7. Pitfalls

The regression test currently cannot run in this environment because `better-sqlite3` is built against the wrong Node ABI for the test process.

So the code path is fixed and typechecks, the live API confirms the behavior, but the Vitest run still needs the local native module mismatch cleaned up.

### 8. Expert insights

Workflow dashboards rot when they overfit to state-machine milestones and ignore operational events.

If the product has automation, retries, and asynchronous prompts, recency must come from the event stream, not only the phase label.

### 9. Transferable lessons

For workflow products, separate these questions explicitly:
- what exists
- what should be recommended
- what happened most recently

Those are related, but they are not the same query.

---

## Board freshness hardening follow-up

### 1. Approach

I added a second freshness layer so the board does not depend only on `STATE.json` writes.

The dashboard now has two protections:
- archived sprints are filtered inside the recommendation engine itself
- tmux session activity is available as a live fallback signal when terminal work is happening without a new state write

### 2. Rejected alternatives

I did not force every terminal interaction to write `STATE.json`. That would create a lot of noisy state churn and still miss tool-native activity that stays inside tmux.

### 3. Connections

This closes the remaining gap after the earlier dashboard fix:
- previous fix: use `activity_history`
- new hardening: if work happens only in tmux, we still have a runtime recency signal

### 4. Tools

Used:
- tmux `session_activity`
- pure recommendation test
- `npx tsc --noEmit`

### 5. Tradeoffs

tmux activity is runtime-only. It improves freshness while a session is alive, but it is not persisted product history. That is correct: runtime liveness and product state should stay separate.

### 6. Pitfalls

This does not make the board magically understand intent. If a tool spins or loops inside tmux, the board may look fresh because the terminal is active. That is still better than looking dead while work is happening, but freshness is not the same as correctness.

### 7. Expert insights

Dashboards get brittle when they trust only durable state or only live telemetry. You want both:
- durable history for truth
- live runtime signals for freshness

### 8. Transferable lessons

For agent workflows, treat "recency" as a merged signal:
- persisted events
- state-machine transitions
- runtime activity

If you rely on only one, the board will eventually lie.

---

## Dashboard stale sprint follow-up

### 1. Approach

I checked whether the cards were fake UI residue or real sprint records.

They were real:
- the four `gstack-*` cards exist under `.gstack/.sprints/`
- `sentry-monitor-health` exists under this repo's `.sprints/`
- the tmux sessions are also still alive

So I did not delete data. I changed the dashboard to stop treating stale unfinished sprints as current work by default.

### 2. Rejected alternatives

I did not auto-delete or auto-archive these sprints. That would be a product decision with data-loss risk, not a cleanup refactor.

I also did not hide them at the API layer. They still matter for history and recovery, so this belongs in the attention model, not the truth model.

### 3. Connections

This sits right at the boundary between workflow truth and workflow attention.

The sprint files are still true.
The dashboard attention model was the problem.

So now:
- fresh unfinished sprints stay visible as active
- stale unfinished sprints move behind an explicit reveal
- completed sprints still live in their own section

### 4. Tools

Used:
- filesystem inspection of `.sprints/` in both repos
- `tmux ls` to confirm the sessions were genuinely still around
- targeted Vitest on `sprint-health`
- frontend production build

### 5. Tradeoffs

This is a visibility change, not a lifecycle change.

Meaning:
- stale sprints still exist
- server state still knows about them
- dashboard clutter drops without destroying recovery paths

If later you want stricter cleanup, that should be a separate policy feature.

### 6. Mistakes

The original dashboard overloaded "not complete" into "active enough to deserve screen space."

That is too naive once you have abandoned planning sessions and long-lived tmux shells.

### 7. Pitfalls

Board view still exposes the full underlying sprint set, because that screen is closer to system truth than the dashboard summary view.

If you want stale hiding to be global, that should be done intentionally everywhere, not piecemeal.

### 8. Expert insights

Workflow tools usually need two different lenses:
- source of truth
- source of attention

Using the same rule for both is what creates "why is this still here?" moments.

### 9. Transferable lessons

When users complain about stale objects in a dashboard, first check whether the bug is:
- bad data
- bad lifecycle
- bad visibility defaults

Here it was the third one.

---

## Board visibility follow-up

### 1. Approach

The first fix only touched the dashboard list view.

The board had its own sprint selection logic in `use-board.ts`, so stale sprints were still being admitted there even after the dashboard looked cleaner.

I fixed that by putting the board visibility rule in one helper and applying it before phase columns are built.

### 2. Rejected alternatives

I did not duplicate the stale check inline one more time. That is how this split happened in the first place.

### 3. Connections

This was a classic two-surfaces, two-rules bug:
- dashboard page
- board page

Same product concept, different filtering code.

### 4. Tools

Used:
- board hook trace
- focused unit test for board visibility
- frontend build

### 5. Tradeoffs

Stale sprints are hidden by default on the board, but still appear if you explicitly filter for `stale`.

That keeps the board clean without losing recoverability.

### 6. Mistakes

The earlier change solved the symptom you reported in one place, not the rule system-wide.

### 7. Pitfalls

Any future new surface that renders sprint lists should either reuse the same helper or it will drift again.

### 8. Expert insights

Whenever two UI surfaces represent the same entity state, the selection rule should live in one shared helper before design polish starts.

### 9. Transferable lessons

If a bug survives the first fix, check whether the product has parallel code paths that look conceptually identical but are implemented separately.

---

## Stale tmux session follow-up

### 1. Approach

I treated this as another truth-vs-attention mismatch.

The sidebar was calling `/api/tmux-sessions`, and that endpoint was returning every matched tmux sprint session even if the underlying sprint was already stale and hidden everywhere else.

So I fixed the API surface instead of piling on another frontend filter.

### 2. Rejected alternatives

I did not auto-kill the tmux sessions. That is a destructive cleanup policy, not a visibility fix.

I also did not hide them only in the sidebar. If another surface asks for tmux sessions later, it should get the same answer.

### 3. Connections

This completes the same cleanup arc:
- dashboard visibility
- board visibility
- tmux session visibility

All three now use the same mental model of "current work" instead of each inventing its own.

### 4. Tools

Used:
- `tmux list-sessions`
- server trace through `/api/tmux-sessions`
- focused Vitest coverage
- frontend build

### 5. Tradeoffs

This hides stale tmux sessions from the app, but leaves the real tmux server untouched.

That is deliberate:
- safe for user work
- enough to clean the product UI
- leaves room for a separate cleanup action later

### 6. Mistakes

The earlier fixes cleaned sprint visibility, but the tmux API still leaked stale work back into the sidebar.

### 7. Pitfalls

If you actually want old tmux sessions terminated, that still needs an explicit cleanup path. This patch does not change process lifecycle.

### 8. Expert insights

Runtime session lists should almost never be shown raw. They need product semantics layered on top, or the UI drifts toward "everything the machine knows about" instead of "everything the user should care about."

### 9. Transferable lessons

When one stale object keeps resurfacing in different views, look for a lower shared feed and fix it there.

---

## Auto-reaping stale tmux sessions follow-up

### 1. Approach

After hiding stale sprint sessions from the UI, I checked the real tmux server and found the deeper issue: stale inactive sprint sessions could still sit around at the process layer and eventually leak back into product surfaces.

So I added a reaping rule to the tmux detection loop itself:
- if a sprint is stale/hidden
- and the tmux pane is not actively doing work
- kill the tmux session during detection

### 2. Rejected alternatives

I did not kill every stale session unconditionally.

That would be too aggressive for sessions still waiting on user input or actively running a tool. The safe rule is stale plus inactive, not stale alone.

### 3. Connections

This finishes the stack:
- dashboard hides stale sprint cards
- board hides stale sprint cards
- tmux sessions API hides stale sprint sessions
- tmux detector now reaps stale inactive tmux sessions

So the product is no longer just masking the symptom. It also cleans up the underlying stale process state.

### 4. Tools

Used:
- `tmux capture-pane`
- `tmux list-sessions`
- focused helper tests
- frontend build

### 5. Tradeoffs

I intentionally preserved interactive waiting sessions. If a pane is still clearly asking for input, it is treated as active and not reaped.

That protects in-flight work, even if the sprint is stale on paper.

### 6. Mistakes

The earlier work aligned visibility, but left stale runtime processes alive. That meant the system could regress whenever a lower-level feed surfaced raw tmux state.

### 7. Pitfalls

If `isAgentActive()` ever under-detects a tool's waiting/running state, the reap rule could become too aggressive. That makes the activity detector an important trust boundary.

### 8. Expert insights

Cleanup policies should be attached to the lifecycle observer that already has the right context, not bolted on as one-off maintenance scripts.

### 9. Transferable lessons

When a stale-runtime bug keeps reappearing, do not stop at filtering. Add lifecycle cleanup at the same layer that discovers liveness.
