import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyEvent,
} from 'react';
import type { LaunchBatch, LaunchRow, ProjectSummary } from '../types';
import { useBatchCreate, MAX_BATCH_ROWS } from '../hooks/use-batch-create';
import type { PreflightResult, PreflightStatus } from '../hooks/use-batch-create';
import { useBatchLaunch } from '../hooks/use-batch-launch';
import { BatchRowList } from './BatchRowList';

type MobileStep = 'draft' | 'review' | 'launch' | 'results';

interface BatchClosePayload {
  createdRows: LaunchRow[];
}

interface Props {
  projects: ProjectSummary[];
  toolId: string;
  onClose: (payload?: BatchClosePayload) => void;
  onOpenSession: (row: LaunchRow) => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const RESULT_ROW_ORDER: Record<LaunchRow['state'], number> = {
  failed: 0,
  interrupted: 1,
  blocked: 2,
  launching: 3,
  launchable: 4,
  created: 5,
};

function getFocusableElements(root: HTMLDivElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

function summarizeRows(rows: LaunchRow[]) {
  return rows.reduce(
    (summary, row) => {
      summary[row.state] += 1;
      return summary;
    },
    {
      blocked: 0,
      created: 0,
      failed: 0,
      interrupted: 0,
      launching: 0,
      launchable: 0,
    },
  );
}

export function BatchCreateOverlay({ projects, toolId, onClose, onOpenSession }: Props) {
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

  const {
    batch,
    rows: launchRows,
    status: launchStatus,
    transport,
    errorMessage: launchErrorMessage,
    launchBatch,
    isLaunching,
  } = useBatchLaunch();

  const createdRows = useMemo(
    () => launchRows.filter((row) => row.state === 'created'),
    [launchRows],
  );
  const rowSummary = useMemo(() => summarizeRows(launchRows), [launchRows]);
  const hasLaunchResults = !!batch;
  const canClose = !isLaunching;
  const mobileStepLabels: MobileStep[] = ['draft', 'review', 'launch', 'results'];

  const safeClose = useCallback(() => {
    if (!canClose) return;
    onClose(createdRows.length > 0 ? { createdRows } : undefined);
  }, [canClose, createdRows, onClose]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') safeClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [safeClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (launchStatus === 'running' || launchStatus === 'settled') {
      setMobileStep('results');
    }
  }, [launchStatus]);

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

  async function handleLaunch() {
    if (!draftText.trim() || !preflightResult || preflightResult.launchable_count === 0 || isLaunching) {
      return;
    }
    await launchBatch(draftText);
  }

  async function handleMobileNext() {
    if (mobileStep === 'draft') {
      const ready = status === 'done' ? true : await runPreflight();
      if (ready) setMobileStep('review');
      return;
    }

    if (mobileStep === 'review') {
      setMobileStep('launch');
      return;
    }

    if (mobileStep === 'launch') {
      await handleLaunch();
    }
  }

  const previewMeta = hasLaunchResults
    ? `${rowSummary.created} created · ${rowSummary.failed + rowSummary.interrupted} issues`
    : preflightResult
      ? `${preflightResult.launchable_count} ok · ${preflightResult.blocked_count} blocked`
      : null;

  return (
    <div
      className="batch-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Batch Create"
      ref={overlayRef}
      onKeyDown={handleOverlayKeyDown}
    >
      <header className="batch-overlay__header">
        <div className="batch-overlay__header-left">
          <span className="batch-overlay__title">BATCH CREATE</span>
          <span className="batch-overlay__subtitle">
            {hasLaunchResults ? 'Result board stays open until launch settles' : 'Launch multiple sessions at once'}
          </span>
        </div>
        <div className="batch-overlay__header-right">
          <nav className="batch-overlay__mobile-steps" aria-label="Steps">
            {mobileStepLabels.map((step, i) => (
              <button
                key={step}
                className={`batch-overlay__mobile-step${mobileStep === step ? ' batch-overlay__mobile-step--active' : ''}${mobileStepLabels.indexOf(mobileStep) > i ? ' batch-overlay__mobile-step--done' : ''}`}
                onClick={() => {
                  if (isLaunching) return;
                  setMobileStep(step);
                }}
                aria-current={mobileStep === step ? 'step' : undefined}
                disabled={isLaunching && step !== 'results'}
              >
                <span className="batch-overlay__mobile-step-num">{i + 1}</span>
                <span className="batch-overlay__mobile-step-label">{step.toUpperCase()}</span>
              </button>
            ))}
          </nav>
          <button
            ref={closeButtonRef}
            className="batch-overlay__close"
            onClick={safeClose}
            aria-label="Close Batch Create"
            disabled={!canClose}
            title={canClose ? undefined : 'Wait for launch to settle before closing'}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="batch-overlay__body">
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
            isLoading={status === 'loading' || isLaunching || launchStatus === 'settled'}
            overCap={overCap}
            rowCount={rowCount}
            status={status}
          />
        </section>

        <section
          className={`batch-overlay__preview${mobileStep === 'review' || mobileStep === 'results' ? ' batch-overlay__zone--active' : ''}`}
          aria-label={hasLaunchResults ? 'Results' : 'Preview'}
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">{hasLaunchResults ? 'RESULTS' : 'REVIEW'}</span>
            {previewMeta && <span className="batch-overlay__zone-label-meta">{previewMeta}</span>}
          </div>
          {hasLaunchResults ? (
            <ResultPane
              batch={batch}
              rows={launchRows}
              transport={transport}
              launchStatus={launchStatus}
              onOpenSession={onOpenSession}
            />
          ) : (
            <PreviewPane
              preflightResult={preflightResult}
              status={status}
              errorMessage={errorMessage}
              onPreflight={runPreflight}
              hasDraft={draftText.trim().length > 0}
            />
          )}
        </section>

        <aside
          className={`batch-overlay__rail${mobileStep === 'launch' || mobileStep === 'results' ? ' batch-overlay__zone--active' : ''}`}
          aria-label="Summary and launch"
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">{hasLaunchResults ? 'SUMMARY' : 'LAUNCH'}</span>
          </div>
          <BatchRail
            preflightResult={preflightResult}
            batch={batch}
            rows={launchRows}
            preflightStatus={status}
            launchStatus={launchStatus}
            transport={transport}
            launchErrorMessage={launchErrorMessage}
            rowCount={rowCount}
            onLaunch={handleLaunch}
            onClose={safeClose}
            canClose={canClose}
          />
        </aside>
      </div>

      <footer className="batch-overlay__mobile-nav">
        {mobileStep !== 'draft' && (
          <button
            className="batch-overlay__mobile-nav-btn batch-overlay__mobile-nav-btn--back"
            onClick={() => {
              if (isLaunching) return;
              const idx = mobileStepLabels.indexOf(mobileStep);
              if (idx > 0) setMobileStep(mobileStepLabels[idx - 1]);
            }}
            disabled={isLaunching}
          >
            ← Back
          </button>
        )}
        {mobileStep !== 'results' && (
          <button
            className="batch-overlay__mobile-nav-btn batch-overlay__mobile-nav-btn--next"
            onClick={handleMobileNext}
            disabled={
              status === 'loading' ||
              (mobileStep === 'draft' && !draftText.trim()) ||
              (mobileStep === 'launch' && (!preflightResult || preflightResult.launchable_count === 0 || isLaunching))
            }
          >
            {status === 'loading'
              ? 'Checking…'
              : mobileStep === 'draft'
                ? 'Preflight →'
                : mobileStep === 'review'
                  ? 'Launch setup →'
                  : isLaunching
                    ? 'Launching…'
                    : 'Launch →'}
          </button>
        )}
      </footer>
    </div>
  );
}

interface ComposerProps {
  projects: ProjectSummary[];
  toolId: string;
  draftText: string;
  onDraftChange: (text: string) => void;
  onPreflight: () => Promise<boolean>;
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
            Row kinds: <code>sprint-existing</code> {' · '} <code>explore-existing</code>
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
          Input exceeds {MAX_BATCH_ROWS} rows — only the first {MAX_BATCH_ROWS} will be processed.
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
          {isLoading ? 'Locked' : status === 'done' ? '↻ Re-check' : 'Preflight ↗'}
        </button>
      </div>
    </div>
  );
}

interface PreviewPaneProps {
  preflightResult: PreflightResult | null;
  status: PreflightStatus;
  errorMessage: string | null;
  onPreflight: () => Promise<boolean>;
  hasDraft: boolean;
}

function PreviewPane({
  preflightResult,
  status,
  errorMessage,
  onPreflight,
  hasDraft,
}: PreviewPaneProps) {
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

interface ResultPaneProps {
  batch: LaunchBatch;
  rows: LaunchRow[];
  transport: 'idle' | 'live' | 'polling';
  launchStatus: 'idle' | 'submitting' | 'running' | 'settled' | 'error';
  onOpenSession: (row: LaunchRow) => void;
}

function ResultPane({ batch, rows, transport, launchStatus, onOpenSession }: ResultPaneProps) {
  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const stateDelta = RESULT_ROW_ORDER[a.state] - RESULT_ROW_ORDER[b.state];
        return stateDelta !== 0 ? stateDelta : a.position - b.position;
      }),
    [rows],
  );

  return (
    <div className="batch-preview batch-preview--done">
      {transport === 'polling' && launchStatus === 'running' && (
        <div className="batch-preview__transport-banner" role="status">
          Live stream disconnected. Polling persisted batch state until launch settles.
        </div>
      )}
      <div className="batch-result-board" aria-live={launchStatus === 'running' ? 'polite' : undefined}>
        <div className="batch-result-board__header">
          <span className={`batch-state-pill batch-state-pill--${batch.state}`}>{batch.state}</span>
          <span className="batch-result-board__updated">Updated {formatTimestamp(batch.updated_at)}</span>
        </div>
        <ul className="batch-row-list" aria-label="Launch results">
          {sortedRows.map((row) => {
            const issueText = row.error_message ?? row.blocked_reason;
            const canOpen = row.state === 'created' && !!row.tmux_name;
            return (
              <li key={row.id} className={`batch-row-item batch-row-item--${row.state}`}>
                <span className="batch-row-item__pos" aria-hidden="true">
                  {String(row.position + 1).padStart(2, '0')}
                </span>
                <span className="batch-row-item__dot" aria-label={row.state} title={row.state} />
                <div className="batch-row-item__body">
                  <div className="batch-row-item__label-row">
                    <div className="batch-row-item__label">{row.label}</div>
                    <span className={`batch-state-chip batch-state-chip--${row.state}`}>{row.state}</span>
                  </div>
                  <div className="batch-row-item__meta">
                    <span className="batch-row-item__kind">{row.row_kind}</span>
                    {row.tool_id !== 'claude' && <span className="batch-row-item__tool">{row.tool_id}</span>}
                    {row.tmux_name && <span className="batch-row-item__tmux">{row.tmux_name}</span>}
                  </div>
                  {issueText && <div className="batch-row-item__reason">{issueText}</div>}
                  {canOpen && (
                    <div className="batch-row-item__actions">
                      <button
                        className="batch-row-item__open-btn"
                        onClick={() => onOpenSession(row)}
                      >
                        Open session
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

interface RailProps {
  preflightResult: PreflightResult | null;
  batch: LaunchBatch | null;
  rows: LaunchRow[];
  preflightStatus: PreflightStatus;
  launchStatus: 'idle' | 'submitting' | 'running' | 'settled' | 'error';
  transport: 'idle' | 'live' | 'polling';
  launchErrorMessage: string | null;
  rowCount: number;
  onLaunch: () => Promise<void>;
  onClose: () => void;
  canClose: boolean;
}

function BatchRail({
  preflightResult,
  batch,
  rows,
  preflightStatus,
  launchStatus,
  transport,
  launchErrorMessage,
  rowCount,
  onLaunch,
  onClose,
  canClose,
}: RailProps) {
  const launchSummary = summarizeRows(rows);
  const total = batch?.total_rows ?? preflightResult?.rows.length ?? (rowCount > 0 ? rowCount : null);
  const launchable = batch ? launchSummary.launchable + launchSummary.launching + launchSummary.created + launchSummary.failed + launchSummary.interrupted : preflightResult?.launchable_count ?? null;
  const blocked = batch ? launchSummary.blocked : preflightResult?.blocked_count ?? null;
  const created = batch ? launchSummary.created : null;
  const failed = batch ? launchSummary.failed + launchSummary.interrupted : null;

  const canLaunch =
    !batch &&
    launchStatus !== 'submitting' &&
    preflightStatus === 'done' &&
    (preflightResult?.launchable_count ?? 0) > 0;

  return (
    <div className="batch-rail">
      <div className="batch-rail__counts">
        <CountRow label="ROWS" value={total} />
        <CountRow label="READY" value={launchable} tone={batch ? 'ok' : launchable ? 'ok' : 'dim'} />
        <CountRow label="BLOCKED" value={blocked} tone={blocked ? 'blocked' : 'dim'} />
        {batch && <CountRow label="CREATED" value={created} tone={created ? 'ok' : 'dim'} />}
        {batch && <CountRow label="FAILED" value={failed} tone={failed ? 'blocked' : 'dim'} />}
      </div>

      <div className="batch-rail__divider" />

      <div className="batch-rail__summary">
        <p className="batch-rail__summary-text">
          {renderRailSummary({
            batch,
            preflightResult,
            preflightStatus,
            launchStatus,
            transport,
            launchSummary,
          })}
        </p>
        {launchErrorMessage && (
          <p className="batch-rail__error" role="alert">
            {launchErrorMessage}
          </p>
        )}
      </div>

      <div className="batch-rail__actions">
        <button
          className="batch-rail__launch-btn"
          disabled={!canLaunch}
          aria-disabled={!canLaunch}
          onClick={() => void onLaunch()}
          title={canLaunch ? undefined : batch ? 'Batch already launched' : 'Run preflight first'}
        >
          {launchStatus === 'submitting'
            ? 'Starting…'
            : launchStatus === 'running'
              ? 'Launching…'
              : batch
                ? 'Launched'
                : 'Launch Batch'}
        </button>
        <button
          className="batch-rail__cancel-btn"
          onClick={onClose}
          disabled={!canClose}
          title={canClose ? undefined : 'Wait for launch to settle before closing'}
        >
          {batch ? 'Close results' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

function CountRow({
  label,
  value,
  tone = 'dim',
}: {
  label: string;
  value: number | null;
  tone?: 'dim' | 'ok' | 'blocked';
}) {
  return (
    <div className="batch-rail__count-row">
      <span className="batch-rail__count-label">{label}</span>
      <span
        className={`batch-rail__count-value${tone === 'dim' ? ' batch-rail__count-value--dim' : tone === 'ok' ? ' batch-rail__count-value--ok' : ' batch-rail__count-value--blocked'}`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function renderRailSummary({
  batch,
  preflightResult,
  preflightStatus,
  launchStatus,
  transport,
  launchSummary,
}: {
  batch: LaunchBatch | null;
  preflightResult: PreflightResult | null;
  preflightStatus: PreflightStatus;
  launchStatus: 'idle' | 'submitting' | 'running' | 'settled' | 'error';
  transport: 'idle' | 'live' | 'polling';
  launchSummary: ReturnType<typeof summarizeRows>;
}) {
  if (!batch) {
    if (preflightStatus === 'idle') return 'Run preflight to see launch summary.';
    if (preflightStatus === 'loading') return 'Checking rows…';
    if (preflightStatus === 'error') return 'Preflight failed — fix the draft and retry.';
    if (!preflightResult) return 'Preflight results will appear here.';
    if (preflightResult.launchable_count === 0) return 'All rows are blocked. Fix errors and re-run preflight.';
    if (preflightResult.blocked_count > 0) {
      return `${preflightResult.launchable_count} ready · ${preflightResult.blocked_count} blocked and will be skipped.`;
    }
    return `${preflightResult.launchable_count} row${preflightResult.launchable_count !== 1 ? 's' : ''} ready to launch.`;
  }

  if (launchStatus === 'submitting') return 'Creating persisted batch and starting launch…';
  if (batch.state === 'launching') {
    return transport === 'polling'
      ? `${launchSummary.created} launched so far. Live stream dropped, polling persisted state.`
      : `${launchSummary.created} launched so far. Overlay stays open until launch settles.`;
  }
  if (batch.state === 'completed') {
    return `${launchSummary.created} session${launchSummary.created !== 1 ? 's' : ''} launched successfully.`;
  }
  if (batch.state === 'partial') {
    return `${launchSummary.created} launched · ${launchSummary.failed + launchSummary.interrupted} failed/interrupted · ${launchSummary.blocked} blocked.`;
  }
  if (batch.state === 'interrupted') {
    return `${launchSummary.created} launched before interruption. Review result rows before closing.`;
  }
  return 'Launch failed before the batch could fully settle.';
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
