import { getProjects } from './sprint-config.js';
import { readSprintState } from './sprint-state.js';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

const NTFY_URL = process.env.NTFY_URL || 'https://ntfy.sh';
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const NTFY_ENABLED = process.env.NTFY_ENABLED === 'true';
const BASE_URL = process.env.BASE_URL || '';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Track which sprints we've already notified about to avoid spam
const notifiedSprints = new Set<string>();

async function sendNtfy(title: string, body: string, tags: string = 'robot') {
  if (!NTFY_ENABLED || !NTFY_TOPIC) return;

  const headers: Record<string, string> = {
    'Title': title,
    'Tags': tags,
    'Priority': '4',
  };

  if (BASE_URL) {
    headers['Actions'] = `view, Open Dashboard, ${BASE_URL}`;
  }

  await fetch(`${NTFY_URL}/${NTFY_TOPIC}`, {
    method: 'POST',
    headers,
    body,
  }).catch((err) => {
    console.error('[sprint-ntfy] Failed to send:', err.message);
  });
}

function checkBlockedSprints() {
  const projects = getProjects();

  for (const project of projects) {
    const sprintsDir = join(project.path, '.sprints');
    if (!existsSync(sprintsDir)) continue;

    try {
      const entries = readdirSync(sprintsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        const state = readSprintState(join(sprintsDir, entry.name));
        if (!state || !state.blocked) continue;

        const key = `${project.id}/${state.feature}`;
        if (notifiedSprints.has(key)) continue;

        // Sprint is blocked — notify
        notifiedSprints.add(key);
        sendNtfy(
          `Blocked: ${project.id}/${state.feature}`,
          state.blocked_reason || 'Sprint is blocked (no reason given)',
          'warning',
        );
      }
    } catch {
      // Can't read sprints dir
    }
  }
}

/** Start polling for sprint notifications. */
export function startSprintNotifications() {
  if (!NTFY_ENABLED || !NTFY_TOPIC) {
    console.log('[sprint-ntfy] Notifications disabled (NTFY_ENABLED=false or no topic)');
    return;
  }

  console.log(`[sprint-ntfy] Polling every ${POLL_INTERVAL_MS / 1000}s, topic: ${NTFY_TOPIC}`);
  // Initial check after 30 seconds (let server warm up)
  setTimeout(checkBlockedSprints, 30_000);
  setInterval(checkBlockedSprints, POLL_INTERVAL_MS);
}
