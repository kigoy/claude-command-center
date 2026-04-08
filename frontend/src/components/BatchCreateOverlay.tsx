import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../types';

// Mobile stepped flow states
type MobileStep = 'draft' | 'review' | 'launch' | 'results';

interface Props {
  projects: ProjectSummary[];
  toolId: string;
  onClose: () => void;
}

export function BatchCreateOverlay({ projects, toolId, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [mobileStep, setMobileStep] = useState<MobileStep>('draft');

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Focus trap: focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const mobileStepLabels: MobileStep[] = ['draft', 'review', 'launch', 'results'];

  return (
    <div
      className="batch-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Batch Create"
      ref={overlayRef}
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
        {/* Composer pane — draft input (Atom 7 will fill this) */}
        <section
          className={`batch-overlay__composer${mobileStep === 'draft' ? ' batch-overlay__zone--active' : ''}`}
          aria-label="Composer"
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">DRAFT</span>
          </div>
          <ComposerPlaceholder projects={projects} toolId={toolId} />
        </section>

        {/* Preview pane — preflight preview rows (Atom 7 will fill this) */}
        <section
          className={`batch-overlay__preview${mobileStep === 'review' ? ' batch-overlay__zone--active' : ''}`}
          aria-label="Preview"
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">REVIEW</span>
          </div>
          <PreviewPlaceholder />
        </section>

        {/* Summary rail — launch CTA and counts (Atom 8 will fill this) */}
        <aside
          className={`batch-overlay__rail${mobileStep === 'launch' || mobileStep === 'results' ? ' batch-overlay__zone--active' : ''}`}
          aria-label="Summary and launch"
        >
          <div className="batch-overlay__zone-header">
            <span className="batch-overlay__zone-label">LAUNCH</span>
          </div>
          <RailPlaceholder onClose={onClose} />
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
            onClick={() => {
              const idx = mobileStepLabels.indexOf(mobileStep);
              if (idx < mobileStepLabels.length - 1) setMobileStep(mobileStepLabels[idx + 1]);
            }}
          >
            {mobileStep === 'launch' ? 'Launch →' : 'Next →'}
          </button>
        )}
      </footer>
    </div>
  );
}

// --- Placeholder zones (replaced in Atom 7 / Atom 8) ---

function ComposerPlaceholder({ projects, toolId }: { projects: ProjectSummary[]; toolId: string }) {
  return (
    <div className="batch-placeholder">
      <p className="batch-placeholder__hint">
        Paste rows — one session per line.<br />
        <code>project | feature description</code>
      </p>
      <textarea
        className="batch-placeholder__textarea"
        placeholder={`${projects[0]?.id ?? 'my-project'} | feat-new-login\n${projects[0]?.id ?? 'my-project'} | feat-dashboard-refresh`}
        rows={8}
        aria-label="Batch input — one row per session"
        readOnly
      />
      <p className="batch-placeholder__note">
        Tool: <strong>{toolId}</strong> · Up to 20 rows · Preflight coming in Atom 7
      </p>
    </div>
  );
}

function PreviewPlaceholder() {
  return (
    <div className="batch-placeholder batch-placeholder--empty">
      <div className="batch-placeholder__empty-icon">▣</div>
      <p className="batch-placeholder__empty-text">
        Preview appears after preflight.<br />
        <span className="batch-placeholder__empty-sub">Composer → Preflight → see launchable / blocked rows here</span>
      </p>
    </div>
  );
}

function RailPlaceholder({ onClose }: { onClose: () => void }) {
  return (
    <div className="batch-rail">
      <div className="batch-rail__counts">
        <div className="batch-rail__count-row">
          <span className="batch-rail__count-label">ROWS</span>
          <span className="batch-rail__count-value batch-rail__count-value--dim">—</span>
        </div>
        <div className="batch-rail__count-row">
          <span className="batch-rail__count-label">LAUNCHABLE</span>
          <span className="batch-rail__count-value batch-rail__count-value--ok">—</span>
        </div>
        <div className="batch-rail__count-row">
          <span className="batch-rail__count-label">BLOCKED</span>
          <span className="batch-rail__count-value batch-rail__count-value--blocked">—</span>
        </div>
      </div>

      <div className="batch-rail__divider" />

      <div className="batch-rail__summary">
        <p className="batch-rail__summary-text">
          Run preflight to see launch summary.
        </p>
      </div>

      <div className="batch-rail__actions">
        <button className="batch-rail__launch-btn" disabled aria-disabled="true">
          Launch Batch
        </button>
        <button className="batch-rail__cancel-btn" onClick={onClose}>
          Cancel
        </button>
      </div>

      <p className="batch-rail__atom-note">
        Execute wiring in Atom 8
      </p>
    </div>
  );
}
