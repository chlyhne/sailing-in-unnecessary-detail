(() => {
  'use strict';
  const loader = document.querySelector('script[data-comments-api]');
  if (!loader || !document.body.classList.contains('article') || !location.pathname.startsWith('/posts/')) return;

  const post = location.pathname.replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const api = local ? 'http://127.0.0.1:8787' : loader.dataset.commentsApi;
  const section = document.createElement('section');
  section.id = 'comments';
  section.className = 'post-comments';
  section.setAttribute('aria-labelledby', 'comments-heading');
  section.innerHTML = `
    <h2 id="comments-heading">Comments</h2>
    <form class="comment-form">
      <label for="comment-name">Name</label>
      <input id="comment-name" name="name" autocomplete="name" required maxlength="80">
      <label for="comment-body">Comment</label>
      <textarea id="comment-body" name="body" rows="5" required maxlength="4000"></textarea>
      <div class="comment-honeypot" aria-hidden="true">
        <label for="comment-website">Website</label>
        <input id="comment-website" name="website" tabindex="-1" autocomplete="off">
      </div>
      <p class="comment-help">Your name and comment will be public. No account or email required.</p>
      <button type="submit">Post comment</button>
      <p class="comment-status" data-form-status role="status" aria-live="polite"></p>
    </form>
    <p class="comment-status" data-list-status role="status" aria-live="polite">Loading comments…</p>
    <div class="comment-list" aria-label="Reader comments"></div>
    <button type="button" class="comments-more" hidden>Load older comments</button>
  `;
  loader.before(section);
  const form = section.querySelector('form');
  const submit = form.querySelector('button[type="submit"]');
  const formStatus = section.querySelector('[data-form-status]');
  const listStatus = section.querySelector('[data-list-status]');
  const list = section.querySelector('.comment-list');
  const more = section.querySelector('.comments-more');
  const seen = new Set();
  let cursor = null;
  let loading = false;
  let posting = false;

  function showComment(comment, prepend = false) {
    if (seen.has(comment.id)) return;
    seen.add(comment.id);
    const article = document.createElement('article');
    article.className = 'reader-comment';
    const header = document.createElement('header');
    const name = document.createElement('strong');
    name.textContent = comment.name;
    const time = document.createElement('time');
    time.dateTime = comment.created_at;
    time.textContent = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(comment.created_at));
    header.append(name, time);
    const body = document.createElement('p');
    body.textContent = comment.body;
    article.append(header, body);
    if (prepend) list.prepend(article);
    else list.append(article);
  }

  async function loadComments() {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const url = new URL('/comments', api);
      url.searchParams.set('post', post);
      if (cursor) url.searchParams.set('before', cursor);
      const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error('load');
      const data = await response.json();
      data.comments.forEach(comment => showComment(comment));
      cursor = data.nextCursor;
      listStatus.textContent = seen.size ? '' : 'No comments yet. Be the first to add one.';
      more.hidden = !cursor;
      more.textContent = 'Load older comments';
    } catch {
      listStatus.textContent = 'Comments could not be loaded. Please try again.';
      more.hidden = false;
      more.textContent = 'Try again';
    } finally {
      loading = false;
      more.disabled = false;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (posting || !form.reportValidity()) return;
    posting = true;
    submit.disabled = true;
    submit.textContent = 'Posting…';
    formStatus.textContent = '';
    const fields = new FormData(form);
    try {
      const response = await fetch(new URL('/comments', api), {
        method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post, name: fields.get('name'), body: fields.get('body'), website: fields.get('website') }),
      });
      const data = await response.json();
      if (!response.ok) {
        formStatus.textContent = data.error || 'Your comment could not be posted. Please try again.';
        return;
      }
      showComment(data.comment, true);
      form.elements.body.value = '';
      listStatus.textContent = '';
      formStatus.textContent = 'Your comment has been posted.';
    } catch {
      formStatus.textContent = 'Your comment could not be posted. Please try again; your text has been kept.';
    } finally {
      posting = false;
      submit.disabled = false;
      submit.textContent = 'Post comment';
    }
  });
  more.addEventListener('click', loadComments);
  loadComments();
})();
