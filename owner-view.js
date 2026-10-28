(() => {
  'use strict';
  const key = 'sailing-owner-until';
  const incoming = location.hash.match(/^#owner=(\d+)$/);
  let expiresAt = 0;
  try { expiresAt = Number(localStorage.getItem(key)); } catch { /* Storage may be disabled. */ }
  if (incoming) {
    expiresAt = Number(incoming[1]);
    try {
      if (expiresAt > Date.now()) localStorage.setItem(key, String(expiresAt));
      else localStorage.removeItem(key);
    } catch { /* Keep owner view for this page when storage is unavailable. */ }
    history.replaceState(null, '', location.pathname + location.search);
  }
  // This is a display preference, not an authentication credential. Draft URLs
  // are public; comment management always checks its own server-side session.
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
  document.documentElement.dataset.ownerView = 'true';
  document.querySelectorAll('[data-draft]').forEach(item => { item.hidden = false; });
  const template = document.querySelector('#owner-latest-post');
  const latest = document.querySelector('#latest-post');
  if (template) {
    const article = template.content.cloneNode(true);
    if (latest) latest.replaceWith(article);
    else document.querySelector('.site-content').append(article);
  }
  document.querySelectorAll('[data-draft-href]').forEach(link => {
    link.href = link.dataset.draftHref;
  });
  const ownerLink = document.querySelector('[data-owner-link]');
  if (ownerLink) ownerLink.textContent = 'Owner settings';
})();
