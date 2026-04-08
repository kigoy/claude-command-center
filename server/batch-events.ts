/**
 * Dedicated SSE invalidation channel for batch state.
 * Separate from sprint-sse.ts — does NOT use filesystem watchers.
 *
 * Contract: events nudge the client to refetch from GET /api/batches/:id.
 * The persisted batch record is the source of truth; this stream only
 * signals that something changed.
 *
 * On connect, if ?batchId=<id> is provided, an immediate batch-changed event
 * is emitted so reconnecting clients refetch without waiting for the next
 * change (no blank-state on reconnect).
 */

import type { Express, Request, Response } from 'express';

interface SSEClient {
  id: number;
  res: Response;
}

let clientIdCounter = 0;
const clients: SSEClient[] = [];
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepalive(): void {
  if (keepaliveInterval) return;
  keepaliveInterval = setInterval(() => {
    const msg = `: keepalive ${Date.now()}\n\n`;
    for (let i = clients.length - 1; i >= 0; i--) {
      try {
        clients[i].res.write(msg);
      } catch {
        clients.splice(i, 1);
      }
    }
  }, 15_000);
}

/** Broadcast a batch-changed event to all connected clients. */
export function notifyBatchChanged(batchId: string): void {
  const msg = `event: batch-changed\ndata: ${JSON.stringify({ batchId, ts: Date.now() })}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].res.write(msg);
    } catch {
      clients.splice(i, 1);
    }
  }
}

/** Mount GET /api/batch-events on the app. Call once during server setup. */
export function setupBatchEvents(app: Express): void {
  startKeepalive();

  app.get('/api/batch-events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');

    // On reconnect: immediately nudge client to refetch the watched batch.
    const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : null;
    if (batchId) {
      res.write(`event: batch-changed\ndata: ${JSON.stringify({ batchId, ts: Date.now() })}\n\n`);
    }

    const client: SSEClient = { id: ++clientIdCounter, res };
    clients.push(client);

    req.on('close', () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
    });
  });
}
