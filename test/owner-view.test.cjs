const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('owner-view.js', 'utf8');

function browser({ stored = null, hash = '', template = true, storageDisabled = false } = {}) {
  const now = 1000000;
  const state = { stored, replaced: false, cleaned: null, appended: false };
  const draft = { hidden: true };
  const link = { dataset: { draftHref: '/posts/draft/index.html' } };
  const ownerLink = { textContent: 'Owner sign-in' };
  const html = { dataset: {} };
  const article = { kind: 'draft' };
  const document = {
    documentElement: html,
    querySelectorAll: selector => selector === '[data-draft]' ? [draft] : [link],
    querySelector: selector => ({
      '#owner-latest-post': template ? { content: { cloneNode: () => article } } : null,
      '#latest-post': { replaceWith: value => { assert.equal(value, article); state.replaced = true; } },
      '.site-content': { append: () => { state.appended = true; } },
      '[data-owner-link]': ownerLink,
    })[selector],
  };
  const storage = {
    getItem: () => state.stored,
    setItem: (key, value) => { assert.equal(key, 'sailing-owner-until'); state.stored = value; },
    removeItem: () => { state.stored = null; },
  };
  const context = {
    document, Date: { now: () => now },
    location: { hash, pathname: '/', search: '?example=1' },
    history: { replaceState: (_data, _title, path) => { state.cleaned = path; } },
  };
  if (!storageDisabled) context.localStorage = storage;
  vm.runInNewContext(source, context);
  return { state, draft, link, ownerLink, html };
}

test('visitors keep the published homepage and hidden draft links', () => {
  for (const stored of [null, '999999', 'invalid']) {
    const { state, draft, link, html } = browser({ stored });
    assert.equal(state.replaced, false);
    assert.equal(draft.hidden, true);
    assert.equal(link.href, undefined);
    assert.equal(html.dataset.ownerView, undefined);
  }
});

test('returning from owner sign-in reveals drafts and selects the draft homepage article', () => {
  const { state, draft, link, ownerLink, html } = browser({ hash: '#owner=1100000' });
  assert.equal(state.stored, '1100000');
  assert.equal(state.cleaned, '/?example=1');
  assert.equal(state.replaced, true);
  assert.equal(draft.hidden, false);
  assert.equal(link.href, '/posts/draft/index.html');
  assert.equal(html.dataset.ownerView, 'true');
  assert.equal(ownerLink.textContent, 'Owner settings');
});

test('owner view persists across pages and leaves comment anchors intact', () => {
  const { state, draft, html } = browser({ stored: '1100000', hash: '#comments', template: false });
  assert.equal(state.cleaned, null);
  assert.equal(state.replaced, false);
  assert.equal(draft.hidden, false);
  assert.equal(html.dataset.ownerView, 'true');
});

test('sign-out clears a remembered owner view before showing the page', () => {
  const { state, draft, html } = browser({ stored: '1100000', hash: '#owner=0' });
  assert.equal(state.stored, null);
  assert.equal(state.replaced, false);
  assert.equal(draft.hidden, true);
  assert.equal(html.dataset.ownerView, undefined);
});

test('disabled local storage permits owner view for the current return from sign-in', () => {
  const { state, draft } = browser({ hash: '#owner=1100000', storageDisabled: true });
  assert.equal(state.replaced, true);
  assert.equal(draft.hidden, false);
});
