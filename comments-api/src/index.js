import { adminRequest } from './admin.js';

const BLOG_ORIGIN = 'https://sailinginunnecessarydetail.com';
const PAGE_SIZE = 50;
const MAX_BODY_BYTES = 20000;

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function normalisePost(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value, BLOG_ORIGIN);
    if (![new URL(BLOG_ORIGIN).hostname, 'www.sailinginunnecessarydetail.com'].includes(url.hostname)) return null;
    const path = url.pathname.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
    return /^\/posts\/(?:[a-z0-9][a-z0-9_-]*\/)+$/i.test(path) ? path : null;
  } catch {
    return null;
  }
}

export function validateComment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Please enter your name and comment.');
  }
  const post = normalisePost(input.post);
  if (!post) throw new HttpError(400, 'This is not a blog post.');
  if (input.website) throw new HttpError(400, 'The comment could not be submitted.');
  if (typeof input.name !== 'string' || typeof input.body !== 'string') {
    throw new HttpError(400, 'Please enter your name and comment.');
  }
  const name = input.name.trim().replace(/\s+/g, ' ');
  const body = input.body.trim();
  if (!name || name.length > 80) throw new HttpError(400, 'Please use a name between 1 and 80 characters.');
  if (!body || body.length > 4000) throw new HttpError(400, 'Please write a comment between 1 and 4,000 characters.');
  return { post, name, body };
}

async function readJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'Please submit your comment using the form.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Please enter your name and comment.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, 'The comment is too long.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'The comment could not be read.');
  }
}

async function checkRateLimit(request, env, now) {
  if (!env.RATE_LIMIT_SALT || env.RATE_LIMIT_SALT.length < 32) {
    throw new HttpError(503, 'Comments are temporarily unavailable. Please try again later.');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.RATE_LIMIT_SALT),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const day = new Date(now).toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${day}:${ip}`));
  const client = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  for (const [windowSeconds, maximum] of [[30, 1], [3600, 20]]) {
    const window = Math.floor(now / (windowSeconds * 1000));
    const entry = await env.DB.prepare(`
      INSERT INTO rate_limits (key, count, expires_at) VALUES (?1, 1, ?2)
      ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ?3
      RETURNING count
    `).bind(`${client}:${windowSeconds}:${window}`, (window + 1) * windowSeconds, maximum).first();
    if (!entry) throw new HttpError(429, 'Please wait a little before posting another comment.',
      { 'Retry-After': String(windowSeconds) });
  }
}

async function listComments(url, env) {
  const post = normalisePost(url.searchParams.get('post'));
  if (!post) throw new HttpError(400, 'This is not a blog post.');
  const rawCursor = url.searchParams.get('before');
  const before = rawCursor === null ? null : Number(rawCursor);
  if (rawCursor !== null && (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(before) || before <= 0)) {
    throw new HttpError(400, 'Invalid comment page.');
  }
  const { results } = await env.DB.prepare(`
    SELECT id, name, body, created_at FROM comments
    WHERE post = ?1 AND (?2 IS NULL OR id < ?2)
    ORDER BY id DESC LIMIT ?3
  `).bind(post, before, PAGE_SIZE + 1).all();
  const comments = results.slice(0, PAGE_SIZE);
  return { comments, nextCursor: results.length > PAGE_SIZE ? comments.at(-1).id : null };
}

export async function handleRequest(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/admin' || path.startsWith('/admin/') ||
      (env.ASSETS && path !== '/comments' && path !== '/health')) return adminRequest(request, env);
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || BLOG_ORIGIN).split(',').map(value => value.trim());
  if (env.ADMIN_ORIGIN) allowed.push(env.ADMIN_ORIGIN);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body),
    { status, headers: { ...headers, ...extra } });
  try {
    if (origin && !allowed.includes(origin)) throw new HttpError(403, 'This website cannot submit comments.');
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      if (!env.DB) throw new HttpError(503, 'The comments database is unavailable.');
      await env.DB.prepare('SELECT 1 AS ok').first();
      return json({ ok: true });
    }
    if (url.pathname !== '/comments') throw new HttpError(404, 'Not found.');
    if (request.method === 'OPTIONS') {
      if (!origin) throw new HttpError(403, 'An origin is required.');
      return new Response(null, { status: 204, headers: { ...headers,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
    }
    if (!env.DB) throw new HttpError(503, 'Comments are temporarily unavailable.');
    if (request.method === 'GET') return json(await listComments(url, env));
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.', { Allow: 'GET, POST, OPTIONS' });
    if (!origin) throw new HttpError(403, 'Please post your comment from the blog.');
    const input = validateComment(await readJson(request));
    const now = Date.now();
    await checkRateLimit(request, env, now);
    const comment = await env.DB.prepare(`
      INSERT INTO comments (post, name, body, created_at) VALUES (?1, ?2, ?3, ?4)
      RETURNING id, name, body, created_at
    `).bind(input.post, input.name, input.body, new Date(now).toISOString()).first();
    return json({ comment }, 201);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status, error.headers);
    console.error('Comment request failed:', error.name);
    return json({ error: 'Comments are temporarily unavailable. Please try again later.' }, 503);
  }
}

export default {
  fetch: handleRequest,
  async scheduled(_event, env) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?1')
      .bind(Math.floor(Date.now() / 1000)).run();
    for (const table of ['admin_oauth', 'admin_sessions']) {
      await env.DB.prepare(`DELETE FROM ${table} WHERE expires_at < ?1`)
        .bind(Math.floor(Date.now() / 1000)).run();
    }
  },
};
