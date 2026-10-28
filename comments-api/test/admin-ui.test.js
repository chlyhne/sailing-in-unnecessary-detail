import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import test from 'node:test';
import { ADMIN_JS } from '../src/admin-ui.js';

function browser(responses, confirmation = false) {
  class Element {
    children = [];
    handlers = {};
    hidden = true;
    textContent = '';
    addEventListener(type, handler) { this.handlers[type] = handler; }
    append(...elements) { elements.forEach(element => { element.parent = this; this.children.push(element); }); }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const elements = Object.fromEntries(['status', 'login', 'logout', 'comments', 'more', 'blog'].map(id => [id, new Element()]));
  const requests = [];
  const confirmations = [];
  const location = { reload() {} };
  vm.runInNewContext(ADMIN_JS, {
    document: { querySelector: selector => elements[selector.slice(1)], createElement: () => new Element() },
    fetch: async (path, options) => { requests.push({ path, options }); return responses.shift(); },
    confirm: message => { confirmations.push(message); return confirmation; },
    location, URL,
  });
  return { elements, requests, confirmations, location };
}
const flush = async () => { await setImmediate(); await setImmediate(); };
const comment = { id: 7, name: '<img onerror=alert(1)>', body: '<script>evil</script>',
  post: '/posts/example/', created_at: '2026-10-28T12:00:00Z' };

test('unsigned visitor sees GitHub sign-in', async () => {
  const { elements } = browser([Response.json({ error: 'Please sign in with GitHub.' }, { status: 401 })]);
  await flush();
  assert.equal(elements.login.hidden, false);
  assert.equal(elements.logout.hidden, true);
  assert.equal(elements.status.textContent, 'Please sign in with GitHub.');
});

test('owner UI renders comments as text and cancellation sends no delete request', async () => {
  const { elements, requests, confirmations } = browser([
    Response.json({ csrf: 'csrf-token' }),
    Response.json({ comments: [comment], nextCursor: null }),
  ]);
  await flush();
  const article = elements.comments.children[0];
  assert.equal(article.children[0].textContent, comment.name);
  assert.equal(article.children[3].textContent, comment.body);
  await article.children[4].handlers.click();
  assert.match(confirmations[0], /cannot be undone/);
  assert.equal(requests.length, 2);
});

test('confirmed deletion uses CSRF and removes the comment only after success', async () => {
  const { elements, requests } = browser([
    Response.json({ csrf: 'csrf-token' }),
    Response.json({ comments: [comment], nextCursor: null }),
    Response.json({ ok: true }),
  ], true);
  await flush();
  await elements.comments.children[0].children[4].handlers.click();
  assert.equal(requests[2].path, '/admin/comments/7');
  assert.equal(requests[2].options.method, 'DELETE');
  assert.equal(requests[2].options.headers['X-CSRF-Token'], 'csrf-token');
  assert.equal(elements.comments.children.length, 0);
  assert.equal(elements.status.textContent, 'Comment deleted.');
});

test('return to the blog enables owner view until session expiry and sign-out clears it', async () => {
  const expiresAt = Date.now() + 100000;
  const { elements, requests, location } = browser([
    Response.json({ csrf: 'csrf-token', expiresAt }),
    Response.json({ comments: [], nextCursor: null }),
    Response.json({ ok: true }),
  ]);
  await flush();
  assert.equal(elements.blog.href, 'https://sailinginunnecessarydetail.com/#owner=' + expiresAt);
  await elements.logout.handlers.click();
  assert.equal(requests[2].path, '/admin/logout');
  assert.equal(requests[2].options.headers['X-CSRF-Token'], 'csrf-token');
  assert.equal(location.href, 'https://sailinginunnecessarydetail.com/#owner=0');
});
