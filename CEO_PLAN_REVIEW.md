# CEO Plan Review: Parallel Batch Sprint and Idea Launch
**Review Date:** 2026-04-08
**Status:** UPDATED PLAN ASSESSMENT
**Score:** 8.5/10

---

## 5-Dimension Review

### 1. **Vision Clarity & Differentiation** ✓ PASS
**Assessment:** Excellent improvement in this dimension.

**Strengths:**
- 10x Check is compelling and specific: "fan out a whole strategy in one move"
- Platonic Ideal paints concrete UX moments (launch deck feeling, preflight visibility, recovery paths)
- Vocabulary section clearly defines 6 key terms that ground the entire narrative
- Vision speaks to the actual pain point: sequential launch workflows vs. parallel batch operations

**No Issues Identified.** Previous concerns about vague positioning appear resolved. The vision now has both scale ambition (10x) and behavioral grounding (launch deck UX pattern).

---

### 2. **Scope Governance & Feasibility** ⚠ PARTIAL PASS
**Issues Identified:**

| Issue | Severity | Fix |
|-------|----------|-----|
| **Concurrency cap undefined** | Medium | Specify the "small concurrency cap" with a concrete number (e.g., 3-5 parallel rows). Otherwise preflight validation and row launch timing may diverge. Add to Concurrency and Recovery Rules or a Limits section. |
| **Race-window collision handling vague** | Medium | "Execute re-validates before each row launch" — clarify whether collision detection is synchronous (blocking) or async (best-effort). If async, define SLA for re-validation latency. Adds complexity if not scoped crisply. |
| **New-project collision scope unclear** | Low | "Duplicate new-project directory targets" — does this mean within a batch only, or global collision with existing projects? Global check requires file I/O and introduces latency. Recommend clarifying in data model or adding to Limits. |

**Strengths:**
- Scope decisions table shows disciplined trade-offs; all three proposals marked ACCEPTED with clear reasoning
- "Deferred to TODOS.md" section is present and reasonable (AI inference, spreadsheet UX, auto-open terminals)
- State machines are precise with retry paths defined
- Recovery rules are not just stated but enumerated (parallel cap, advisory preflight, row-level failure isolation)

**Recommendation:** Add a **Limits & Constraints** section with:
- Concurrency cap: `[N]` rows in flight at once
- Batch max size: `[M]` rows per batch
- Re-validation SLA: `[T]ms` per row before launch
- Collision detection scope: within-batch only, or global

---

### 3. **User Journey & Value Delivery** ✓ PASS
**Assessment:** Strong and actionable.

**Strengths:**
- 8-step user journey is concrete and end-to-end (Create → Resolve → Preflight → Launch → Result → Save/Replay/Retry)
- Each step maps to a clear outcome users can see (rows resolve, collisions appear, result board lands)
- Recovery paths are first-class (Save → Replay, Retry Failed) — not an afterthought
- Journey shows both happy path (Create → Launch → Done) and recovery loop (Failed → Retry)

**No Critical Issues.** The journey walks users through discovery, confidence building (preflight), action, and recovery. Previous concerns about unclear value delivery appear resolved.

**One minor observation:** The journey mentions "selected tool" in step 3 but does not clarify whether tool selection is per-row or batch-wide. Suggest clarifying: "Each row inherits the batch tool default unless overridden." This is implied by "selected tool defaults" in Data Model but should be explicit in the journey.

---

### 4. **Technical Architecture & Data Model** ✓ PASS
**Assessment:** Well-scoped and implementable.

**Strengths:**
- Row kinds explicitly enumerated: `sprint-existing`, `explore-existing`, `explore-new-project` — no ambiguity
- Row fields are complete (row_id, kind, tool_id, raw_name, normalized_name, description, target reference, predicted output)
- Batch fields include optional link to launch set — enables replay without re-parsing
- State machines are deterministic with clear transitions (draft → preflighted → launching → completed*)
- Retry path is isolated: `launch_failed → retry_queued → launching → [success|failure]`

**No Critical Issues.** The data model is flat, normalized, and avoids circular dependencies. The state machines do not introduce race conditions.

**Optional enhancement (not blocking):** Consider adding `batch_version` and `row_version` fields to support non-destructive batch mutations. If a user edits a draft batch before preflight, you need to track whether that mutation should re-validate specific rows. Current model does not preclude this; mentioning it here for future-proofing.

---

### 5. **Completeness & Deferred Scope** ✓ PASS
**Assessment:** Appropriately scoped with clear deferral.

**Strengths:**
- Deferred section explicitly lists three items: AI inference, spreadsheet UX, auto-open terminals
- Each deferred item is labeled (not left ambiguous)
- Deferral rationale is present: "deterministic parsing" for v1, UX polish in v2
- Mission Control surface explicitly states: "does not replace one-by-one dialogs immediately" — avoids over-commitment

**No Issues Identified.** Deferred scope is crisply bounded. The plan respects the distinction between core capability (batch engine + result board) and polish (AI assist, bulk editor, multi-terminal).

**Clarification note:** "If usage shifts heavily to batch launch, the single-item flows can later become thin wrappers" — this is forward-looking strategy, not a current risk. Good product thinking.

---

## Summary of Issue Resolution

| Dimension | Previous Concern | Status | Evidence |
|-----------|-----------------|--------|----------|
| Vision | Vague positioning | **RESOLVED** | Platonic Ideal and 10x Check now concrete; vocabulary grounds language |
| Scope | Over-commitment or ambiguity | **MOSTLY RESOLVED** | Clear deferral + state machines, but concurrency cap and collision scope need clarification (Medium severity) |
| User Value | Unclear recovery paths | **RESOLVED** | Result board, replay, and retry are now first-class and journeyed |
| Technical | Data model gaps | **RESOLVED** | Row kinds, fields, state machines all specified; flat and implementable |
| Completeness | Unclear boundaries | **RESOLVED** | Deferred scope is explicit; Mission Control strategy clear |

---

## Quality Score: **8.5 / 10**

### Breakdown:
- **Vision & Differentiation:** 9/10 (compelling, specific, well-grounded)
- **Scope Governance:** 8/10 (strong, but concurrency cap and collision scope need 1-2 clarifications)
- **User Value & Journey:** 9/10 (end-to-end, recovery-first, clear outcomes)
- **Technical Soundness:** 9/10 (data model is clean; state machines work)
- **Completeness & Deferral:** 8/10 (crisply bounded, but one optional version-tracking enhancement for future robustness)

### Why Not 9+?
The plan is excellent and ready to move forward. Two medium-severity gaps prevent a 9:
1. Concurrency cap is referenced but not numerically defined
2. Collision detection scope (batch-local vs. global) is implicit, not explicit

Both are resolvable in a 15-min call or design doc addendum. Not blockers, but design risks if left ambiguous during implementation.

### Recommendation
**Approve with addendum:** Merge this plan and create a 1-page **Limits & Constraints** doc specifying:
- Concurrency cap (e.g., 5 parallel rows)
- Max batch size (e.g., 100 rows)
- Re-validation latency SLA
- Collision detection scope (batch-local, or global check if feasible)

This keeps the CEO plan strategic and elevates implementation details to a runbook without cluttering the vision.

---

**Status:** ✅ **READY TO BUILD** (with minor design clarifications)
