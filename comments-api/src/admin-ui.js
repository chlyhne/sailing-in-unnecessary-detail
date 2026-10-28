export const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Manage comments · Sailing in Unnecessary Detail</title>
<link rel="stylesheet" href="/admin/style.css"><script src="/admin/app.js" defer></script></head>
<body><a href="https://sailinginunnecessarydetail.com/">Back to the blog</a>
<header><h1>Manage comments</h1><button id="logout" hidden>Sign out</button></header>
<p id="status" role="status">Checking sign-in…</p>
<p id="login" hidden><a href="/admin/login">Sign in with GitHub</a></p>
<div id="comments"></div><button id="more" hidden>Load older comments</button></body></html>`;

// Keep browser code as text so Worker bundling cannot inject runtime helpers.
export const ADMIN_JS = `(function adminApp() {
  const status = document.querySelector('#status');
  const login = document.querySelector('#login');
  const logout = document.querySelector('#logout');
  const list = document.querySelector('#comments');
  const more = document.querySelector('#more');
  let csrf;
  let cursor = null;
  let loading = false;

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-CSRF-Token': csrf || '', ...options.headers } });
    const data = await response.json();
    if (response.status === 401) {
      login.hidden = false;
      logout.hidden = true;
      list.replaceChildren();
      more.hidden = true;
    }
    if (!response.ok) throw new Error(data.error || 'Please try again.');
    return data;
  }

  function show(comment) {
    const article = document.createElement('article');
    const heading = document.createElement('h2');
    heading.textContent = comment.name;
    const meta = document.createElement('p');
    meta.textContent = new Date(comment.created_at).toLocaleString();
    const link = document.createElement('a');
    link.textContent = comment.post;
    link.href = new URL(comment.post, 'https://sailinginunnecessarydetail.com').href + '#comments';
    const body = document.createElement('p');
    body.textContent = comment.body;
    const remove = document.createElement('button');
    remove.textContent = 'Delete comment';
    remove.addEventListener('click', async () => {
      if (!confirm(\`Delete this comment by \${comment.name}? This cannot be undone.\\n\\n\${comment.body.slice(0, 200)}\`)) return;
      remove.disabled = true;
      try {
        await api(\`/admin/comments/\${comment.id}\`, { method: 'DELETE' });
        article.remove();
        status.textContent = 'Comment deleted.';
      } catch (error) {
        status.textContent = error.message;
        remove.disabled = false;
      }
    });
    article.append(heading, meta, link, body, remove);
    list.append(article);
  }

  async function load() {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const data = await api('/admin/comments' + (cursor ? \`?before=\${cursor}\` : ''));
      data.comments.forEach(show);
      cursor = data.nextCursor;
      more.hidden = !cursor;
      more.textContent = 'Load older comments';
      status.textContent = list.children.length ? '' : 'No comments yet.';
    } catch (error) {
      status.textContent = error.message;
      if (login.hidden) {
        more.hidden = false;
        more.textContent = 'Try again';
      }
    } finally {
      loading = false;
      more.disabled = false;
    }
  }
  more.addEventListener('click', load);
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await api('/admin/logout', { method: 'POST' });
      location.reload();
    } catch (error) {
      status.textContent = error.message;
      logout.disabled = false;
    }
  });
  async function start() {
    try {
      const session = await api('/admin/session');
      csrf = session.csrf;
      logout.hidden = false;
      await load();
    } catch (error) {
      status.textContent = error.message;
    }
  }
  start();
})();`;
