import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker, { handleRequest } from '../src/index.js';
import { adminRequest } from '../src/admin.js';
import { ADMIN_JS } from '../src/admin-ui.js';

const ORIGIN = 'https://comments.example';
function environment() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0001_comments.sql', '0002_admin.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const prepare = (sql, bindings = []) => ({
    bind: (...values) => prepare(sql, values),
    async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
    async run() { return sqlite.prepare(sql).run(...bindings); },
  });
  return { DB: { prepare }, sqlite, ADMIN_ORIGIN: ORIGIN, ADMIN_GITHUB_ID: '198742006',
    GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-client-secret' };
}
const request = (path, options = {}) => new Request(ORIGIN + path, options);
const cookieFrom = response => response.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !c.endsWith('=')).join('; ');
async function begin(env) {
  const response = await adminRequest(request('/admin/login'), env);
  assert.equal(response.status, 303);
  return { response, authorize: new URL(response.headers.get('Location')), cookie: cookieFrom(response) };
}
async function finish(env, attempt, userId = 198742006) {
  let calls = 0;
  const github = async (url, options) => {
    calls++;
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(options.body);
      assert.equal(body.client_secret, env.GITHUB_CLIENT_SECRET);
      assert.equal(body.redirect_uri, ORIGIN + '/admin/callback');
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.code_verifier)));
      const challenge = Buffer.from(bytes).toString('base64url');
      assert.equal(challenge, attempt.authorize.searchParams.get('code_challenge'));
      return Response.json({ access_token: 'github-token-not-to-be-stored' });
    }
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(options.headers.Authorization, 'Bearer github-token-not-to-be-stored');
    return Response.json({ id: userId, login: 'login-is-not-the-authorization-check' });
  };
  const response = await adminRequest(request('/admin/callback?code=test-code&state=' + attempt.authorize.searchParams.get('state'),
    { headers: { Cookie: attempt.cookie } }), env, github);
  return { response, calls, cookie: cookieFrom(response) };
}
async function signIn(env) {
  const result = await finish(env, await begin(env));
  assert.equal(result.response.status, 303);
  const session = await adminRequest(request('/admin/session', { headers: { Cookie: result.cookie } }), env);
  assert.equal(session.status, 200);
  return { cookie: result.cookie, csrf: (await session.json()).csrf };
}
function authenticated(path, session, method = 'GET', extra = {}) {
  return request(path, { method, headers: { Cookie: session.cookie, Origin: ORIGIN,
    'X-CSRF-Token': session.csrf, ...extra } });
}
function insert(env, count = 1) {
  const stmt = env.sqlite.prepare('INSERT INTO comments(post,name,body,created_at) VALUES(?,?,?,?)');
  for (let i = 0; i < count; i++) stmt.run('/posts/example/', '<script>evil</script>', `Comment ${i}`, '2026-10-28T12:00:00Z');
}

test('management fails closed without setup and integrates with the Worker router', async () => {
  assert.equal((await handleRequest(request('/admin'), {})).status, 503);
  const env = environment();
  const response = await handleRequest(request('/admin'), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.match(await response.text(), /Sign in with GitHub/);
  // The generated browser script is valid JavaScript and renders user input as text.
  assert.doesNotThrow(() => new Function(ADMIN_JS));
  assert.ok(!ADMIN_JS.includes('innerHTML'));
});

test('GitHub sign-in uses state and PKCE and stores only a hash of the session cookie', async () => {
  const env = environment();
  const attempt = await begin(env);
  assert.equal(attempt.authorize.origin, 'https://github.com');
  assert.equal(attempt.authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(attempt.authorize.searchParams.get('scope'), '');
  assert.match(attempt.response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const result = await finish(env, attempt);
  assert.equal(result.calls, 2);
  assert.equal(result.response.status, 303);
  assert.equal(result.response.headers.get('Location'), '/admin');
  const session = env.sqlite.prepare('SELECT * FROM admin_sessions').get();
  assert.ok(!result.cookie.includes(session.token_hash));
  assert.ok(!JSON.stringify(session).includes('github-token-not-to-be-stored'));
  assert.equal(session.github_id, env.ADMIN_GITHUB_ID);
  assert.ok(session.expires_at <= Date.now() / 1000 + 28800);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM admin_oauth').get().n, 0);
  // A callback cannot be replayed, even with the original cookie and state.
  assert.equal((await finish(env, attempt)).response.status, 403);
});

test('missing, mismatched, expired and cancelled OAuth state never authenticates', async () => {
  const env = environment();
  const attempt = await begin(env);
  const state = attempt.authorize.searchParams.get('state');
  for (const [query, cookie] of [
    [`code=x&state=${state}`, ''], ['code=x&state=other', attempt.cookie],
    [`error=access_denied&state=${state}`, attempt.cookie],
  ]) {
    const response = await adminRequest(request('/admin/callback?' + query, { headers: { Cookie: cookie } }), env,
      () => { throw new Error('GitHub must not be contacted'); });
    assert.equal(response.status, 403);
  }
  env.sqlite.prepare('UPDATE admin_oauth SET expires_at=1').run();
  assert.equal((await finish(env, attempt)).response.status, 403);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM admin_sessions').get().n, 0);
});

test('other GitHub accounts and failed token exchanges receive no session', async () => {
  const env = environment();
  const result = await finish(env, await begin(env), 12345);
  assert.equal(result.response.status, 403);
  assert.equal(result.cookie, '');
  const attempt = await begin(env);
  const failed = await adminRequest(request('/admin/callback?code=x&state=' + attempt.authorize.searchParams.get('state'),
    { headers: { Cookie: attempt.cookie } }), env, async () => Response.json({ error: 'bad_verification_code' }));
  assert.equal(failed.status, 403);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM admin_sessions').get().n, 0);
});

test('anonymous and forged sessions cannot list or delete comments', async () => {
  const env = environment();
  insert(env);
  for (const Cookie of ['', '__Host-comment-admin=forged']) {
    assert.equal((await adminRequest(request('/admin/comments', { headers: { Cookie } }), env)).status, 401);
    assert.equal((await adminRequest(request('/admin/comments/1', { method: 'DELETE', headers: { Cookie } }), env)).status, 401);
  }
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 1);
});

test('deletion requires owner session, exact origin and CSRF; it removes only the selected comment', async () => {
  const env = environment();
  insert(env, 2);
  const session = await signIn(env);
  for (const extra of [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'forged' }]) {
    assert.equal((await adminRequest(authenticated('/admin/comments/1', session, 'DELETE', extra), env)).status, 403);
  }
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 2);
  assert.equal((await adminRequest(authenticated('/admin/comments/1', session, 'GET'), env)).status, 404);
  assert.equal((await adminRequest(authenticated('/admin/comments/1', session, 'DELETE'), env)).status, 200);
  assert.deepEqual(env.sqlite.prepare('SELECT id FROM comments').all().map(c => c.id), [2]);
  assert.equal((await adminRequest(authenticated('/admin/comments/1', session, 'DELETE'), env)).status, 404);
});

test('admin listing pages across all threads without exposing session secrets', async () => {
  const env = environment();
  insert(env, 53);
  const session = await signIn(env);
  const response = await adminRequest(authenticated('/admin/comments', session), env);
  const first = await response.json();
  assert.equal(first.comments.length, 50);
  assert.deepEqual(Object.keys(first.comments[0]).sort(), ['body', 'created_at', 'id', 'name', 'post']);
  assert.equal(first.nextCursor, 4);
  const last = await (await adminRequest(authenticated('/admin/comments?before=4', session), env)).json();
  assert.deepEqual(last.comments.map(c => c.id), [3, 2, 1]);
  assert.equal(last.nextCursor, null);
  assert.equal((await adminRequest(authenticated('/admin/comments?before=bad', session), env)).status, 400);
});

test('expired sessions, changed owner ID and logout revoke access', async () => {
  const env = environment();
  const session = await signIn(env);
  env.ADMIN_GITHUB_ID = '123';
  assert.equal((await adminRequest(authenticated('/admin/comments', session), env)).status, 401);
  env.ADMIN_GITHUB_ID = '198742006';
  env.sqlite.prepare('UPDATE admin_sessions SET expires_at=1').run();
  assert.equal((await adminRequest(authenticated('/admin/comments', session), env)).status, 401);
  const fresh = await signIn(env);
  const logout = await adminRequest(authenticated('/admin/logout', fresh, 'POST'), env);
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await adminRequest(authenticated('/admin/comments', fresh), env)).status, 401);
  await worker.scheduled({}, env);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM admin_sessions').get().n, 0);
});
