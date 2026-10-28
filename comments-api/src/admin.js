import { ADMIN_HTML, ADMIN_JS } from './admin-ui.js';

const SESSION_COOKIE = '__Host-comment-admin';
const STATE_COOKIE = '__Host-comment-oauth';
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const hash = async value => Array.from(await digest(value), b => b.toString(16).padStart(2, '0')).join('');
const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
const getCookie = (request, name) => request.headers.get('Cookie')?.split(/;\s*/).find(c => c.startsWith(name + '='))?.slice(name.length + 1);

export async function adminRequest(request, env, githubFetch = fetch) {
  const url = new URL(request.url);
  const headers = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
  const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
  const redirect = (target, cookies = []) => {
    const response = new Response(null, { status: 303, headers: { ...headers, Location: target } });
    for (const value of cookies) response.headers.append('Set-Cookie', value);
    return response;
  };
  if (!env.DB || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !/^\d+$/.test(env.ADMIN_GITHUB_ID || '') || !env.ADMIN_ORIGIN) {
    return reply({ error: 'Comment management is not configured yet.' }, 503);
  }
  if (url.origin !== env.ADMIN_ORIGIN) return reply({ error: 'Invalid management address.' }, 403);
  if (request.headers.get('Origin') && request.headers.get('Origin') !== env.ADMIN_ORIGIN) {
    return reply({ error: 'This request must come from comment management.' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    if (url.pathname === '/admin' && request.method === 'GET') {
      return new Response(ADMIN_HTML, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/admin/app.js' && request.method === 'GET') {
      return new Response(ADMIN_JS, { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    if (url.pathname === '/admin/style.css' && request.method === 'GET') {
      return new Response('body{max-width:48rem;margin:3rem auto;padding:0 1.25rem;background:#f7f5ef;color:#223a34;font:1rem/1.6 system-ui}a{color:#30695b}article{border-top:1px solid #d9ddd3;padding:1.5rem 0}p{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:.6rem 1rem;cursor:pointer}header{display:flex;gap:1rem;align-items:center;flex-wrap:wrap}[hidden]{display:none!important}', { headers: { ...headers, 'Content-Type': 'text/css' } });
    }
    if (url.pathname === '/admin/login' && request.method === 'GET') {
      const state = randomToken();
      const verifier = randomToken();
      await env.DB.prepare('INSERT INTO admin_oauth (token_hash, verifier, expires_at) VALUES (?1, ?2, ?3)')
        .bind(await hash(state), verifier, now + 600).run();
      const authorize = new URL('https://github.com/login/oauth/authorize');
      const challenge = btoa(String.fromCharCode(...await digest(verifier))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      authorize.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: env.ADMIN_ORIGIN + '/admin/callback', state,
        code_challenge: challenge, code_challenge_method: 'S256', scope: '', allow_signup: 'false' }).toString();
      return redirect(authorize.href, [cookie(STATE_COOKIE, state, 600)]);
    }
    if (url.pathname === '/admin/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state');
      if (!state || state !== getCookie(request, STATE_COOKIE) || !url.searchParams.get('code')) {
        return reply({ error: 'Sign-in expired or was cancelled. Please start again.' }, 403);
      }
      const attempt = await env.DB.prepare('DELETE FROM admin_oauth WHERE token_hash = ?1 RETURNING verifier, expires_at')
        .bind(await hash(state)).first();
      if (!attempt || attempt.expires_at <= now) return reply({ error: 'Sign-in expired. Please start again.' }, 403);
      const tokenResponse = await githubFetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
          code: url.searchParams.get('code'), redirect_uri: env.ADMIN_ORIGIN + '/admin/callback', code_verifier: attempt.verifier }),
      });
      const token = await tokenResponse.json();
      if (!tokenResponse.ok || !token.access_token) return reply({ error: 'GitHub sign-in failed. Please start again.' }, 403);
      const userResponse = await githubFetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sailing-blog-comments' },
      });
      const user = await userResponse.json();
      if (!userResponse.ok || String(user.id) !== env.ADMIN_GITHUB_ID) {
        return reply({ error: 'Only the blog owner can manage comments.' }, 403, { 'Set-Cookie': cookie(STATE_COOKIE, '', 0) });
      }
      // The GitHub token is used only to verify identity and is never stored.
      const session = randomToken();
      await env.DB.prepare('INSERT INTO admin_sessions (token_hash, github_id, csrf, expires_at) VALUES (?1, ?2, ?3, ?4)')
        .bind(await hash(session), String(user.id), randomToken(), now + 28800).run();
      return redirect('/admin', [cookie(SESSION_COOKIE, session, 28800), cookie(STATE_COOKIE, '', 0)]);
    }
    const sessionToken = getCookie(request, SESSION_COOKIE);
    const session = sessionToken && await env.DB.prepare('SELECT github_id, csrf, expires_at FROM admin_sessions WHERE token_hash = ?1')
      .bind(await hash(sessionToken)).first();
    if (!session || session.expires_at <= now || session.github_id !== env.ADMIN_GITHUB_ID) {
      if (url.pathname === '/admin/blog' && request.method === 'GET') {
        return redirect('https://sailinginunnecessarydetail.com/#owner=0');
      }
      return reply({ error: 'Please sign in with GitHub.' }, 401);
    }
    if (url.pathname === '/admin/blog' && request.method === 'GET') {
      return redirect('https://sailinginunnecessarydetail.com/#owner=' + session.expires_at * 1000);
    }
    if (request.method !== 'GET') {
      if (request.headers.get('Origin') !== env.ADMIN_ORIGIN || request.headers.get('X-CSRF-Token') !== session.csrf) {
        return reply({ error: 'Invalid request. Refresh the page and try again.' }, 403);
      }
    }
    if (url.pathname === '/admin/session' && request.method === 'GET') {
      return reply({ csrf: session.csrf, expiresAt: session.expires_at * 1000 });
    }
    if (url.pathname === '/admin/logout' && request.method === 'POST') {
      await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1').bind(await hash(sessionToken)).run();
      return reply({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
    }
    if (url.pathname === '/admin/comments' && request.method === 'GET') {
      const raw = url.searchParams.get('before');
      const before = raw === null ? null : Number(raw);
      if (raw !== null && (!/^\d+$/.test(raw) || !Number.isSafeInteger(before) || before <= 0)) return reply({ error: 'Invalid comment page.' }, 400);
      const { results } = await env.DB.prepare('SELECT id, post, name, body, created_at FROM comments WHERE (?1 IS NULL OR id < ?1) ORDER BY id DESC LIMIT 51').bind(before).all();
      return reply({ comments: results.slice(0, 50), nextCursor: results.length > 50 ? results[49].id : null });
    }
    const match = url.pathname.match(/^\/admin\/comments\/([1-9]\d*)$/);
    if (match && request.method === 'DELETE' && Number.isSafeInteger(Number(match[1]))) {
      const removed = await env.DB.prepare('DELETE FROM comments WHERE id = ?1 RETURNING id').bind(Number(match[1])).first();
      return removed ? reply({ ok: true }) : reply({ error: 'This comment has already been removed.' }, 404);
    }
    return reply({ error: 'Not found.' }, 404);
  } catch {
    return reply({ error: 'Comment management is temporarily unavailable. Please try again.' }, 503);
  }
}
