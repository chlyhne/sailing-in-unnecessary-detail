import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker, { handleRequest, normalisePost, validateComment } from '../src/index.js';

const ORIGIN = 'https://sailinginunnecessarydetail.com';
const POST = '/posts/reading-the-wind/';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_comments.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_admin.sql', import.meta.url), 'utf8'));
  const prepare = (sql, bindings = []) => ({
    bind: (...values) => prepare(sql, values),
    async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
    async run() { return sqlite.prepare(sql).run(...bindings); },
  });
  return { DB: { prepare }, sqlite, ALLOWED_ORIGINS: ORIGIN,
    RATE_LIMIT_SALT: 'test-secret-with-at-least-thirty-two-characters' };
}

function submit(input = {}, overrides = {}) {
  return new Request('https://comments.example/comments', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.1', ...overrides.headers },
    body: JSON.stringify({ post: POST, name: 'Reader', body: 'A useful article.', ...input }),
  });
}

function listing(post = POST, extra = '') {
  return new Request(`https://comments.example/comments?post=${encodeURIComponent(post)}${extra}`);
}

test('post addresses share a thread across index.html, trailing slash and tracking parameters', () => {
  for (const value of [POST, POST.slice(0, -1), POST + 'index.html',
    `${ORIGIN}${POST}index.html?utm_source=test#comments`]) assert.equal(normalisePost(value), POST);
  for (const value of ['/about.html', '/', '/posts/../about.html', 'https://other.example/posts/a/',
    null, '/posts/', '/posts/a.html']) assert.equal(normalisePost(value), null);
  assert.equal(normalisePost('/posts/future/nested-post/'), '/posts/future/nested-post/');
});

test('anonymous input is limited to a public name and comment', () => {
  assert.deepEqual(validateComment({ post: POST, name: '  A   sailor ', body: '  Hello\nworld  ' }),
    { post: POST, name: 'A sailor', body: 'Hello\nworld' });
  for (const input of [null, [], {}, { post: POST, name: ' ', body: 'Hello' },
    { post: POST, name: 'x'.repeat(81), body: 'Hello' },
    { post: POST, name: 'Sailor', body: 'x'.repeat(4001) },
    { post: POST, name: 'Sailor', body: 'Hello', website: 'https://spam.example' }]) {
    assert.throws(() => validateComment(input));
  }
});

test('comments persist and remain isolated to their own posts', async () => {
  const env = environment();
  const posted = await handleRequest(submit({ post: POST + 'index.html' }), env);
  assert.equal(posted.status, 201);
  assert.equal(posted.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const { comment } = await posted.json();
  assert.equal(comment.name, 'Reader');
  assert.equal(comment.body, 'A useful article.');
  assert.ok(Number.isFinite(Date.parse(comment.created_at)));
  assert.deepEqual((await (await handleRequest(listing(), env)).json()).comments, [comment]);
  assert.deepEqual((await (await handleRequest(listing('/posts/different/'), env)).json()).comments, []);
});

test('the owner preview can use the same comment threads as the public blog', async () => {
  const env = environment();
  env.ADMIN_ORIGIN = 'https://comments.example';
  const response = await handleRequest(submit({}, { headers: { Origin: env.ADMIN_ORIGIN } }), env);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ADMIN_ORIGIN);
  const { comment } = await response.json();
  assert.deepEqual((await (await handleRequest(listing(), env)).json()).comments, [comment]);
});

test('stored text is not treated as SQL and never becomes database metadata', async () => {
  const env = environment();
  const name = "Robert'); DROP TABLE comments;--";
  const body = '<script>alert("test")</script>\n<img src=x onerror=alert(1)>';
  assert.equal((await handleRequest(submit({ name, body }), env)).status, 201);
  const data = await (await handleRequest(listing(), env)).json();
  assert.equal(data.comments[0].name, name);
  assert.equal(data.comments[0].body, body);
  assert.deepEqual(Object.keys(data.comments[0]).sort(), ['body', 'created_at', 'id', 'name']);
});

test('older comments can be paged without mixing posts or skipping entries', async () => {
  const env = environment();
  const insert = env.sqlite.prepare('INSERT INTO comments (post,name,body,created_at) VALUES (?,?,?,?)');
  for (let i = 1; i <= 53; i++) insert.run(POST, 'Reader', `Comment ${i}`, '2026-10-27T12:00:00.000Z');
  insert.run('/posts/other/', 'Someone else', 'Different post', '2026-10-27T12:00:00.000Z');
  const first = await (await handleRequest(listing(), env)).json();
  assert.equal(first.comments.length, 50);
  assert.equal(first.comments[0].body, 'Comment 53');
  const second = await (await handleRequest(listing(POST, `&before=${first.nextCursor}`), env)).json();
  assert.deepEqual(second.comments.map(c => c.body), ['Comment 3', 'Comment 2', 'Comment 1']);
  assert.equal(second.nextCursor, null);
  assert.equal((await handleRequest(listing(POST, '&before=1%3BDROP%20TABLE%20comments'), env)).status, 400);
});

test('posting is rate limited and raw IP addresses are not stored', async () => {
  const env = environment();
  assert.equal((await handleRequest(submit(), env)).status, 201);
  const repeated = await handleRequest(submit(), env);
  assert.equal(repeated.status, 429);
  assert.equal(repeated.headers.get('Retry-After'), '30');
  assert.equal((await handleRequest(submit({}, { headers: { 'CF-Connecting-IP': '192.0.2.2' } }), env)).status, 201);
  for (const row of env.sqlite.prepare('SELECT key FROM rate_limits').all()) assert.ok(!row.key.includes('192.0.2.'));
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 2);
});

test('origin checks and preflight permit the blog and reject other origins', async () => {
  const env = environment();
  const rejected = await handleRequest(submit({}, { headers: { Origin: 'https://other.example' } }), env);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
  const preflight = await handleRequest(new Request('https://comments.example/comments', {
    method: 'OPTIONS', headers: { Origin: ORIGIN },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const noOrigin = submit();
  noOrigin.headers.delete('Origin');
  assert.equal((await handleRequest(noOrigin, env)).status, 403);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 0);
});

test('invalid, oversized and honeypot submissions are rejected before storage', async () => {
  const env = environment();
  for (const [body, type, status] of [['{', 'application/json', 400],
    ['{}', 'text/plain', 415], ['x'.repeat(20001), 'application/json', 413]]) {
    const response = await handleRequest(new Request('https://comments.example/comments', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': type }, body,
    }), env);
    assert.equal(response.status, status);
  }
  assert.equal((await handleRequest(submit({ website: 'spam' }), env)).status, 400);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 0);
});

test('rate-limit expiry cleanup preserves comments', async () => {
  const env = environment();
  assert.equal((await handleRequest(submit(), env)).status, 201);
  env.sqlite.prepare('INSERT INTO rate_limits VALUES (?,?,?)').run('expired', 1, 1);
  await worker.scheduled({}, env);
  assert.equal(env.sqlite.prepare('SELECT key FROM rate_limits WHERE key=?').get('expired'), undefined);
  assert.equal(env.sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 1);
});

test('missing database and invalid methods fail without exposing internals', async () => {
  assert.equal((await handleRequest(listing(), {})).status, 503);
  const env = environment();
  assert.equal((await handleRequest(new Request('https://comments.example/unknown'), env)).status, 404);
  assert.equal((await handleRequest(new Request('https://comments.example/comments', { method: 'DELETE' }), env)).status, 405);
  assert.equal((await handleRequest(new Request('https://comments.example/health'), env)).status, 200);
});
