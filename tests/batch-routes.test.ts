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
});
