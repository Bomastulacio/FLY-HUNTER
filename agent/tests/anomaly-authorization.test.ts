import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../../frontend/src/pages/api/anomaly-action.js';

test('A session cannot escalate to global deal writes; only server-managed admins can review pending rows', async () => {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_TOKEN'];
  const original = names.map(name => process.env[name]);
  Object.assign(process.env, { SUPABASE_URL: 'https://offline.invalid', SUPABASE_ANON_KEY: 'public-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', ADMIN_TOKEN: 'backend-only-test-token' });
  let user: Record<string, unknown> = { id: 'test-user', app_metadata: {}, user_metadata: { flight_hunter_admin: true } };
  let writes = 0, pending = true;
  const intercept = mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://offline.invalid');
    if (url.pathname === '/auth/v1/user') return Response.json(user);
    assert.equal(url.pathname, '/rest/v1/flight_deals');
    assert.equal(init?.method, 'PATCH');
    assert.equal(new Headers(init?.headers).get('apikey'), 'server-test-key');
    assert.equal(url.searchParams.get('estado_aprobacion'), 'eq.pendiente');
    writes++;
    return Response.json(pending ? [{ id: '00000000-0000-0000-0000-000000000001', estado_aprobacion: 'aprobado' }] : []);
  });
  const invoke = (adminToken?: string) => POST({ request: new Request('https://app.invalid/api/anomaly-action', {
    method: 'POST', headers: { Authorization: 'Bearer signed-user-session', 'Content-Type': 'application/json',
      ...(adminToken ? { 'X-Admin-Token': adminToken } : {}) },
    body: JSON.stringify({ deal_id: '00000000-0000-0000-0000-000000000001', action: 'aprobar' }),
  }) } as any);
  try {
    assert.equal((await invoke()).status, 403);
    assert.equal((await invoke('wrong-admin-token')).status, 403);
    assert.equal(writes, 0, 'A regular user or editable user_metadata must never reach a service-role write');
    user = { ...user, app_metadata: { flight_hunter_admin: true } };
    assert.equal((await invoke()).status, 200);
    pending = false;
    assert.equal((await invoke()).status, 409, 'A reviewed observation must not be reset or re-notified');
    user = { ...user, app_metadata: {} };
    assert.equal((await invoke('backend-only-test-token')).status, 409);
  } finally {
    intercept.mock.restore();
    names.forEach((name, index) => {
      if (original[index] === undefined) delete process.env[name]; else process.env[name] = original[index];
    });
  }
});
