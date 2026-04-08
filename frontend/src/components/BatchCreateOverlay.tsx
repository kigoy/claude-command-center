import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyEvent } from 'react';
import type { ProjectSummary } from '../types';
import { useBatchCreate, MAX_BATCH_ROWS } from '../hooks/use-batch-create';
import type { PreflightResult, PreflightStatus } from '../hooks/use-batch-create';
import { BatchRowList } from './BatchRowList';

// Mobile stepped flow states
type MobileStep = 'draft' | 'review' | 'launch' | 'results';

interface Props {
  projects: ProjectSummary[];
  toolId: string;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function getFocusableElements(root: HTMLDivElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

export function BatchCreateOverlay({ projects, toolId, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileStep, setMobileStep] = useState<MobileStep>('draft');

  const {
    draftText,
    setDraftText,
    preflightResult,
    status,
    errorMessage,
    runPreflight,
    rowCount,
    overCap,
  } = useBatchCreate();

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Focus the close button on mount so keyboard users land inside the overlay.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  function handleOverlayKeyDown(event: ReactKeyEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(overlayRef.current);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Mobile: "Next" from draft triggers preflight then advances.
  async function handleMobileNext() {
    const idx = mobileStepLabels.indexOf(mobileStep);
    if (idx >= mobileStepLabels.length - 1) return;

    if (mobileStep === 'draft' && draftText.trim() && status !== 'done') {
      await runPreflight();
    }
    setMobileStep(mobileStepLabels[idx + 1]);
  }

  const mobileStepLabels: MobileStep[] = ['draft', 'review', 'launch', 'results'];

  return (
    <div
      className="batch-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Batch Create"
      ref={overlayRef}
      onKeyDown={handleOverlayKeyDown}
    >
      {/* Header */}
      <header className="batch-overlay__header">
        <div className="batch-overlay__header-left">
          <span className="batch-overlay__title">BATCH CREATE</span>
          <span className="batch-overlay__subtitle">Launch multiple sessions at once</span>
        </div>
        <div className="batch-overlay__header-right">
          {/* Mobile step indicator */}
          <nav className="batch-overlay__mobile-steps" aria-label="Steps">
            {mobileStepLabels.map((step, i) => (
              <button
                key={step}
                className={`batch-overlay__mobile-step${mobileStep === step ? ' batch-overlay__mobile-step--active' : ''}${mobileStepLabels.indexOf(mobileStep) > i ? ' batch-overlay__mobile-step--done' : ''}`}
                onClick={() => setMobileStep(step)}
                aria-current={mobileStep === step ? 'step' : undefined}
              >
                <span className="batch-overlay__mobile-step-num">{i + 1}</span>
                <span className="batch-overlay__mobile-step-label">{step.toUpperCase()}</span>
              </button>
            ))}
          </nav>
          <button
            ref={closeButtonRef}
            className="batch-overlay__close"
            onClick={onClose}
            aria-label="Close Batch Create"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Desktop: 3-zone layout. Mobile: single stepped column. */}
      <div className="batch-overlay__body">
        {/* Composer pane */}
        <section
          className={`batch-overlay__composer${mobileStep === 'draft' ? ' batch-overlay__zone--active' : ''}`}
          aria-label="Composer"
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">DRAFT</span>
            {rowCount > 0 && (
              <span className={`batch-overlay__row-count${overCap ? ' batch-overlay__row-count--over' : rowCount >= MAX_BATCH_ROWS ? ' batch-overlay__row-count--at-cap' : ''}`}>
                {rowCount}/{MAX_BATCH_ROWS}
              </span>
            )}
          </div>
          <BatchComposer
            projects={projects}
            toolId={toolId}
            draftText={draftText}
            onDraftChange={setDraftText}
            onPreflight={runPreflight}
            isLoading={status === 'loading'}
            overCap={overCap}
            rowCount={rowCount}
            status={status}
          />
        </section>

        {/* Preview pane */}
        <section
          className={`batch-overlay__preview${mobileStep === 'review' ? ' batch-overlay__zone--active' : ''}`}
          aria-label="Preview"
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">REVIEW</span>
            {preflightResult && (
              <span className="batch-overlay__zone-label-meta">
                {preflightResult.launchable_count} ok · {preflightResult.blocked_count} blocked
              </span>
            )}
          </div>
          <PreviewPane
            preflightResult={preflightResult}
            status={status}
            errorMessage={errorMessage}
            onPreflight={runPreflight}
            hasDraft={draftText.trim().length > 0}
          />
        </section>

        {/* Summary rail */}
        <aside
          className={`batch-overlay__rail${mobileStep === 'launch' || mobileStep === 'results' ? ' batch-overlay__zone--active' : ''}`}
          aria-label="Summary and launch"
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">LAUNCH</span>
          </div>
          <BatchRail
            preflightResult={preflightResult}
            status={status}
            rowCount={rowCount}
            onClose={onClose}
          />
        </aside>
      </div>

      {/* Mobile navigation footer */}
      <footer className="batch-overlay__mobile-nav">
        {mobileStep !== 'draft' && (
          <button
            className="batch-overlay__mobile-nav-btn batch-overlay__mobile-nav-btn--back"
            onClick={() => {
              const idx = mobileStepLabels.indexOf(mobileStep);
              if (idx > 0) setMobileStep(mobileStepLabels[idx - 1]);
            }}
          >
            ← Back
          </button>
        )}
        {mobileStep !== 'results' && (
          <button
            className="batch-overlay__mobile-nav-btn batch-overlay__mobile-nav-btn--next"
            onClick={handleMobileNext}
            disabled={status === 'loading'}
          >
            {status === 'loading'
              ? 'Checking…'
              : mobileStep === 'draft'
                ? 'Preflight →'
                : mobileStep === 'launch'
                  ? 'Launch →'
                  : 'Next →'}
          </button>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer — draft input with teaching example, row cap warnings, preflight CTA
// ---------------------------------------------------------------------------

interface ComposerProps {
  projects: ProjectSummary[];
  toolId: string;
  draftText: string;
  onDraftChange: (text: string) => void;
  onPreflight: () => void;
  isLoading: boolean;
  overCap: boolean;
  rowCount: number;
  status: string;
}

function BatchComposer({
  projects,
  toolId,
  draftText,
  onDraftChange,
  onPreflight,
  isLoading,
  overCap,
  rowCount,
  status,
}: ComposerProps) {
  const exampleProject = projects[0]?.id ?? 'my-project';
  const placeholder = [
    `${exampleProject} | sprint-existing | fix-login`,
    `${exampleProject} | sprint-existing | dashboard-refresh`,
    `${exampleProject} | explore-existing | research-auth`,
  ].join('\n');

  const isEmpty = draftText.trim().length === 0;

  return (
    <div className="batch-composer">
      {isEmpty && (
        <div className="batch-composer__hint">
          <p className="batch-composer__hint-title">One row per line · pipe-delimited</p>
          <code className="batch-composer__hint-format">project | row-kind | name [| tool]</code>
          <p className="batch-composer__hint-kinds">
            Row kinds:{' '}
            <code>sprint-existing</code>
            {' · '}
            <code>explore-existing</code>
          </p>
          <p className="batch-composer__hint-tool">
            Tool defaults to <code>claude</code> · up to {MAX_BATCH_ROWS} rows
          </p>
        </div>
      )}
      <textarea
        className={`batch-composer__textarea${isLoading ? ' batch-composer__textarea--readonly' : ''}`}
        value={draftText}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={placeholder}
        rows={12}
        aria-label="Batch input — one row per session"
        readOnly={isLoading}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
      />
      {overCap && (
        <div className="batch-composer__cap-warning" role="alert">
          ⚠ Input exceeds {MAX_BATCH_ROWS} rows — only the first {MAX_BATCH_ROWS} will be processed.
        </div>
      )}
      <div className="batch-composer__footer">
        <span className="batch-composer__tool-note">
          Tool: <strong>{toolId}</strong>
          {rowCount > 0 && (
            <>
              {' · '}
              {rowCount} row{rowCount !== 1 ? 's' : ''}
            </>
          )}
        </span>
        <button
          className="batch-composer__preflight-btn"
          onClick={onPreflight}
          disabled={isLoading || isEmpty}
          aria-busy={isLoading}
        >
          {isLoading ? 'Checking…' : status === 'done' ? '↻ Re-check' : 'Preflight ↗'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview pane — shows preflight results or empty/error state
// ---------------------------------------------------------------------------

interface PreviewPaneProps {
  preflightResult: PreflightResult | null;
  status: PreflightStatus;
  errorMessage: string | null;
  onPreflight: () => void;
  hasDraft: boolean;
}

function PreviewPane({ preflightResult, status, errorMessage, onPreflight, hasDraft }: PreviewPaneProps) {
  if (status === 'loading') {
    return (
      <div className="batch-preview batch-preview--loading" aria-live="polite" aria-busy="true">
        <div className="batch-preview__spinner" aria-hidden="true" />
        <p className="batch-preview__status-text">Running preflight…</p>
      </div>
    );
  }

  if (status === 'error' && errorMessage) {
    return (
      <div className="batch-preview batch-preview--error" role="alert">
        <p className="batch-preview__error-title">Preflight failed</p>
        <p className="batch-preview__error-msg">{errorMessage}</p>
        {hasDraft && (
          <button className="batch-preview__retry-btn" onClick={onPreflight}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!preflightResult) {
    return (
      <div className="batch-preview batch-preview--empty">
        <div className="batch-preview__empty-icon" aria-hidden="true">▣</div>
        <p className="batch-preview__empty-text">
          Preview appears after preflight.
          <br />
          <span className="batch-preview__empty-sub">
            Enter rows in the Composer, then press <strong>Preflight ↗</strong>
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="batch-preview batch-preview--done">
      {preflightResult.truncated && (
        <div className="batch-preview__truncated-banner" role="alert">
          Input was truncated to {MAX_BATCH_ROWS} rows.
        </div>
      )}
      <BatchRowList rows={preflightResult.rows} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary rail — preflight counts + launch CTA (execute wired in Atom 8)
// ---------------------------------------------------------------------------

interface RailProps {
  preflightResult: PreflightResult | null;
  status: PreflightStatus;
  rowCount: number;
  onClose: () => void;
}

function BatchRail({ preflightResult, status, rowCount, onClose }: RailProps) {
  const launchable = preflightResult?.launchable_count ?? null;
  const blocked = preflightResult?.blocked_count ?? null;
  const total = preflightResult?.rows.length ?? (rowCount > 0 ? rowCount : null);

  const canLaunch = launchable !== null && launchable > 0 && status === 'done';

  return (
    <div className="batch-rail">
      <div className="batch-rail__counts">
        <div className="batch-rail__count-row">
          <span className="batch-rail__count-label">ROWS</span>
          <span className={`batch-rail__count-value${total === null ? ' batch-rail__count-value--dim' : ''}`}>
            {total ?? '—'}
          </span>
        </div>
        <div className="batch-rail__count-row">
          <span className="batch-rail__count-label">LAUNCHABLE</span>
          <span className={`batch-rail__count-value${launchable === null ? ' batch-rail__count-value--dim' : ' batch-rail__count-value--ok'}`}>
            {launchable ?? '—'}
          </span>
        </div>
        <div className="batch-rail__count-row">
          <span className="batch-rail__count-label">BLOCKED</span>
          <span className={`batch-rail__count-value${blocked === null || blocked === 0 ? ' batch-rail__count-value--dim' : ' batch-rail__count-value--blocked'}`}>
            {blocked ?? '—'}
          </span>
        </div>
      </div>

      <div className="batch-rail__divider" />

      <div className="batch-rail__summary">
        <p className="batch-rail__summary-text">
          {status === 'idle' && 'Run preflight to see launch summary.'}
          {status === 'loading' && 'Checking rows…'}
          {status === 'error' && 'Preflight failed — fix errors and retry.'}
          {status === 'done' && preflightResult && (
            launchable === 0
              ? 'All rows blocked. Fix errors and re-run preflight.'
              : blocked !== null && blocked > 0
                ? `${launchable} ready · ${blocked} blocked and will be skipped.`
                : `${launchable} row${launchable !== 1 ? 's' : ''} ready to launch.`
          )}
        </p>
      </div>

      <div className="batch-rail__actions">
        <button
          className="batch-rail__launch-btn"
          disabled={!canLaunch}
          aria-disabled={!canLaunch}
          title={canLaunch ? undefined : 'Run preflight first'}
        >
          Launch Batch
        </button>
        <button className="batch-rail__cancel-btn" onClick={onClose}>
          Cancel
        </button>
      </div>

      <p className="batch-rail__atom-note">Execute wiring in Atom 8</p>
    </div>
  );
}
