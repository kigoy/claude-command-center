import { type Express, type Request, type Response } from 'express';
import { execSync } from 'child_process';
import { getSprintSessions } from './tmux-detect.js';

interface SnippetClient {
  id: number;
  res: Response;
}

let clientIdCounter = 0;
const clients: SnippetClient[] = [];
let pollInterval: ReturnType<typeof setInterval> | null = null;

/** Capture last N lines from a tmux pane. Returns empty array on failure. */
function capturePane(tmuxSession: string, lines: number = 3): string[] {
  try {
    const raw = execSync(
      `tmux capture-pane -t "${tmuxSession}" -p -S -${lines} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2000 },
    );
    return raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .slice(-lines);
  } catch {
    return [];
  }
}

function broadcast(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].res.write(message);
    } catch {
      clients.splice(i, 1);
    }
  }
}

function pollSnippets(): void {
  if (clients.length === 0) return;
  const sessions = getSprintSessions();
  for (const session of sessions) {
    const lines = capturePane(session.sessionName);
    if (lines.length > 0) {
      broadcast('terminal-snippet', {
        key: `${session.projectId}-${session.feature}`,
        lines,
      });
    }
  }
}

export function setupTerminalSnippets(app: Express): void {
  app.get('/api/terminal-snippets', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    const client: SnippetClient = { id: ++clientIdCounter, res };
    clients.push(client);

    // Start polling if this is the first client
    if (!pollInterval) {
      pollInterval = setInterval(pollSnippets, 3000);
    }

    req.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
      // Stop polling if no clients
      if (clients.length === 0 && pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    });
  });
}
