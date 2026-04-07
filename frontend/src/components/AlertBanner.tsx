import { useAlerts } from '../hooks/use-alerts';

export function AlertBanner() {
  const { alerts, dismiss } = useAlerts();

  if (alerts.length === 0) return null;

  return (
    <div className="alert-banner">
      {alerts.map((alert) => (
        <div
          key={alert.sprintKey}
          className={`alert-item alert-item--${alert.severity}`}
        >
          <span className="alert-icon">
            {alert.type === 'blocked' ? '🚫' : '⏳'}
          </span>
          <span className="alert-message">{alert.message}</span>
          <button
            className="alert-dismiss"
            onClick={() => dismiss(alert.sprintKey)}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
