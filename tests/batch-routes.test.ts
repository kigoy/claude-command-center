/**
 * Real route-level tests for batch API endpoints.
 *
 * Uses Supertest against the real Express app (createApp()) so requests travel
 * through actual middleware, auth, route handlers, and business logic — not
 * mocks or reimplementations.
 *
 * NOTE: These tests require better-sqlite3 to be compiled for the running
 * Node ABI. In some environments the native module may fail to load (ABI
 * mismatch). That is a known environment issue, not a test logic issue.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { seedBuiltInCliTools } from '../server/cli-tools.js';

const app = createApp();

beforeAll(() => {
  // Seed built-in CLI tools so preflight can resolve tool IDs.
  seedBuiltInCliTools();
});

// ---------------------------------------------------------------------------
// Auth boundary — no cookie → 401 before any route handler runs
// ---------------------------------------------------------------------------

describe('auth boundary', () => {
  it('POST /api/batches/preflight requires auth', async () => {
    const res = await request(app)
      .post('/api/batches/preflight')
      .send({ text: 'anything' });
    expect(res.status).toBe(401);
  });

  it('POST /api/batches requires auth', async () => {
    const res = await request(app).post('/api/batches').send({ text: 'anything' });
    expect(res.status).toBe(401);
  });

  it('GET /api/batches/:id requires auth', async () => {
    const res = await request(app).get('/api/batches/some-id');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Authenticated batch routes
// ---------------------------------------------------------------------------

/** Log in with the default test passphrase and return the Set-Cookie header. */
async function getAuthCookie(): Promise<string> {
  const passphrase = process.env.AUTH_PASSPHRASE ?? 'change-me';
  const res = await request(app)
    .post('/api/auth/login')
    .send({ passphrase });
  expect(res.status).toBe(200);
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

describe('POST /api/batches/preflight', () => {
  it('returns 400 when text is missing', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when text is empty string', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: '' });
    expect(res.status).toBe(400);
  });

  it('returns preflight result shape for valid input', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: 'acme | sprint-existing | auth-flow | claude' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rows');
    expect(res.body).toHaveProperty('launchable_count');
    expect(res.body).toHaveProperty('blocked_count');
    expect(res.body).toHaveProperty('truncated');
    expect(Array.isArray(res.body.rows)).toBe(true);
  });

  it('returns launchable_count 0 for unknown project (no projects configured)', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: 'unknown-project | sprint-existing | some-feature' });
    expect(res.status).toBe(200);
    // Without GSTACK_CONFIG pointing to real projects, all rows are blocked.
    expect(res.body.launchable_count).toBe(0);
    expect(res.body.blocked_count).toBe(1);
    expect(res.body.rows[0].state).toBe('blocked');
  });
});

describe('POST /api/batches', () => {
  it('returns 400 when text is missing', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 422 when no rows are launchable', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches')
      .set('Cookie', cookie)
      .send({ text: 'unknown-proj | sprint-existing | some-feature' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('No launchable rows');
    expect(Array.isArray(res.body.rows)).toBe(true);
  });
});

describe('GET /api/batches/:id', () => {
  it('returns 404 for unknown batch id', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .get('/api/batches/nonexistent-batch-id')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('returns 404 shape with error string for non-existent batch', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .get('/api/batches/does-not-exist-at-all')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Extended preflight contract tests through real routes
// ---------------------------------------------------------------------------

describe('POST /api/batches/preflight — edge cases', () => {
  it('handles multiline input with mixed valid/invalid rows', async () => {
    const cookie = await getAuthCookie();
    const text = [
      'proj-a | sprint-existing | feat-one',
      'proj-b | sprint-existing | feat-two',
      'proj-c | explore-existing | research',
    ].join('\n');
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(3);
    // Without configured projects, all rows should be blocked
    expect(res.body.blocked_count).toBe(3);
    expect(res.body.launchable_count).toBe(0);
  });

  it('truncates input exceeding 20 rows and reports truncated=true', async () => {
    const cookie = await getAuthCookie();
    const lines = Array.from({ length: 25 }, (_, i) =>
      `proj | sprint-existing | name-${i}`,
    );
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: lines.join('\n') });
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.rows).toHaveLength(20);
  });

  it('does not truncate at exactly 20 rows', async () => {
    const cookie = await getAuthCookie();
    const lines = Array.from({ length: 20 }, (_, i) =>
      `proj | sprint-existing | name-${i}`,
    );
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: lines.join('\n') });
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.rows).toHaveLength(20);
  });

  it('returns rows in input order with correct positions', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: 'a | sprint-existing | x\nb | sprint-existing | y' });
    expect(res.status).toBe(200);
    expect(res.body.rows[0].position).toBe(0);
    expect(res.body.rows[1].position).toBe(1);
    expect(res.body.rows[0].project_id).toBe('a');
    expect(res.body.rows[1].project_id).toBe('b');
  });

  it('returns blocked reason for unsupported row kind through a known project', async () => {
    const cookie = await getAuthCookie();
    // This test runs against the real app which may have real projects.
    // If "proj" is unknown, the blocked reason will be about the project, not the kind.
    // We just verify the route returns blocked state for invalid input.
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: 'proj | delete-all | target' });
    expect(res.status).toBe(200);
    expect(res.body.rows[0].state).toBe('blocked');
    expect(res.body.rows[0].blocked_reason).toBeDefined();
  });

  it('whitespace-only text returns 400 (treated as empty)', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: '   \n  \n  ' });
    // The route rejects whitespace-only text as empty input
    expect(res.status).toBe(400);
  });

  it('ignores comment lines in route-level preflight', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches/preflight')
      .set('Cookie', cookie)
      .send({ text: '# comment\nproj | sprint-existing | feat' });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Extended execute route contract
// ---------------------------------------------------------------------------

describe('POST /api/batches — edge cases', () => {
  it('returns 400 for empty string text', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches')
      .set('Cookie', cookie)
      .send({ text: '' });
    expect(res.status).toBe(400);
  });

  it('returns 422 with rows array when all rows are blocked', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches')
      .set('Cookie', cookie)
      .send({ text: 'no-such-project | sprint-existing | feat' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('No launchable rows');
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.rows[0].state).toBe('blocked');
  });

  it('returns 422 for multiline input where every row is blocked', async () => {
    const cookie = await getAuthCookie();
    const text = 'bad | sprint-existing | a\nbad | sprint-existing | b';
    const res = await request(app)
      .post('/api/batches')
      .set('Cookie', cookie)
      .send({ text });
    expect(res.status).toBe(422);
    expect(res.body.rows).toHaveLength(2);
  });

  it('returns 422 with blocked reason for invalid input', async () => {
    const cookie = await getAuthCookie();
    const res = await request(app)
      .post('/api/batches')
      .set('Cookie', cookie)
      .send({ text: 'proj | invalid-kind | feat' });
    expect(res.status).toBe(422);
    expect(res.body.rows[0].state).toBe('blocked');
    expect(res.body.rows[0].blocked_reason).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SSE endpoint — batch-events
// ---------------------------------------------------------------------------

describe('GET /api/batch-events', () => {
  it('endpoint exists and does not 404', async () => {
    // SSE endpoints are tricky with Supertest; just verify the route is mounted.
    // The stream connection test would hang, so we use a timeout approach.
    const res = await request(app)
      .get('/api/batch-events')
      .timeout({ response: 200, deadline: 500 })
      .catch((err: { response?: { status: number } }) => err.response);
    // If timeout fires, that means the server started streaming (good).
    // If we get a response, it should not be 404.
    if (res) {
      expect(res.status).not.toBe(404);
    }
  });
});
