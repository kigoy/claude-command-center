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
