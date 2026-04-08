import { describe, expect, it } from 'vitest';
import { createRequest, getRequest, listRequests, setResponse } from '../server/mcp-responses.js';

describe('mcp-responses', () => {
  it('lists unresolved requests newest-first and hides answered ones', async () => {
    const oldId = `req-old-${Date.now()}`;
    const newId = `req-new-${Date.now()}`;

    createRequest(oldId, 'session-old', 'Old question?', ['Old'], false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    createRequest(newId, 'session-new', 'New question?', ['New'], true);

    expect(getRequest(oldId)).toBeTruthy();
    expect(getRequest(newId)).toBeTruthy();

    const beforeResponse = listRequests().slice(0, 2);
    expect(beforeResponse[0]?.requestId).toBe(newId);
    expect(beforeResponse[1]?.requestId).toBe(oldId);

    expect(setResponse(newId, 'New')).toBe(true);

    const unresolvedIds = listRequests().map((request) => request.requestId);
    expect(unresolvedIds).not.toContain(newId);
    expect(unresolvedIds).toContain(oldId);
  });
});
