import { useState } from 'react';
import type { PendingQuestion } from '../types';

interface Props {
  requests: PendingQuestion[];
  onRespond: (requestId: string, response: string) => Promise<void>;
  onDismiss: () => void;
}

export function PendingQuestionsPanel({ requests, onRespond, onDismiss }: Props) {
  const [customText, setCustomText] = useState('');
  const [pendingResponse, setPendingResponse] = useState<string | null>(null);
  const [error, setError] = useState('');
  const request = requests[0];

  if (!request) return null;

  async function submit(response: string) {
    setError('');
    setPendingResponse(response);
    try {
      await onRespond(request.requestId, response);
      setCustomText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response');
    } finally {
      setPendingResponse(null);
    }
  }

  const recommended = request.options[0] || null;

  return (
    <div className="dialog-overlay" onClick={onDismiss}>
      <div className="dialog pending-questions-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="pending-questions-header">
          <h2>Question waiting</h2>
          {requests.length > 1 && (
            <span className="pending-questions-count">{requests.length} pending</span>
          )}
        </div>

        {request.sessionName && (
          <p className="pending-questions-session">
            {request.sessionName}
            {request.toolId ? ` • ${request.toolId}` : ''}
          </p>
        )}

        <p className="pending-questions-body">{request.question}</p>

        {recommended && (
          <button
            className="pending-questions-recommended"
            disabled={pendingResponse !== null}
            onClick={() => submit(recommended)}
          >
            {pendingResponse === recommended ? 'Sending…' : `Use recommended: ${recommended}`}
          </button>
        )}

        {request.options.length > 0 && (
          <div className="pending-questions-options">
            {request.options.map((option, index) => (
              <button
                key={option}
                className={index === 0 ? 'pending-questions-option pending-questions-option--recommended' : 'pending-questions-option'}
                disabled={pendingResponse !== null}
                onClick={() => submit(option)}
              >
                {pendingResponse === option ? 'Sending…' : option}
              </button>
            ))}
          </div>
        )}

        {request.allowText && (
          <div className="pending-questions-text">
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Or type your answer…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customText.trim() && pendingResponse === null) {
                  submit(customText.trim());
                }
              }}
              autoFocus={request.options.length === 0}
            />
            <button
              disabled={!customText.trim() || pendingResponse !== null}
              onClick={() => submit(customText.trim())}
            >
              Send
            </button>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="dialog-actions">
          <button onClick={onDismiss}>Close</button>
        </div>
      </div>
    </div>
  );
}
