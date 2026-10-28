(() => {
  'use strict';
  const latest = document.querySelector('.latest-post[data-comments-post]');
  const standalone = document.body.classList.contains('article') && location.pathname.startsWith('/posts/');
  if (!latest && !standalone) return;
  const container = latest || document.querySelector('.site-content');
  const heading = latest?.querySelector('h2') || document.querySelector('#title-block-header');
  const end = latest?.lastElementChild || document.querySelector('#footnotes') || document.querySelector('#comments');
  if (!container || !heading || !end) return;
  const articlePath = (latest?.dataset.commentsPost || location.pathname)
    .replace(/\\/g, '/').replace(/\/index\.html$/i, '/').replace(/\/?$/, '/');
  const articleTitle = heading.textContent.trim();
  const sent = new Set();
  let activeSeconds = 0;
  let lastTick = performance.now();
  let jumped = location.hash === '#comments';

  function consented() {
    try {
      const cookie = document.cookie.split('; ').find(value => value.startsWith('cookie_consent_level='));
      return !!cookie && JSON.parse(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1))).tracking === true
        && typeof window.gtag === 'function';
    } catch { return false; }
  }

  function send(name, parameters = {}) {
    if (!consented()) return;
    window.gtag('event', name, {
      article_path: articlePath,
      article_title: articleTitle,
      article_placement: latest ? 'home' : 'article',
      reading_seconds: Math.floor(activeSeconds),
      ...parameters,
    });
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('.comments-jump a')) return;
    jumped = true;
    send('article_comments_jump');
  });

  function sample() {
    const now = performance.now();
    const elapsed = Math.min((now - lastTick) / 1000, 1.5);
    lastTick = now;
    if (!consented() || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    const start = heading.getBoundingClientRect().bottom;
    // Exclude notes and comments from the article's reading length.
    const finish = latest ? end.getBoundingClientRect().bottom : end.getBoundingClientRect().top;
    const height = window.innerHeight;
    if (jumped) {
      if (finish > height * 1.5) jumped = false;
      else return;
    }
    const visible = Math.min(finish, height) - Math.max(start, 0);
    if (visible < Math.min(height / 2, (finish - start) / 2)) return;
    activeSeconds += elapsed;
    for (const seconds of [30, 60, 120, 300, 600]) {
      const key = `time-${seconds}`;
      if (activeSeconds >= seconds && !sent.has(key)) {
        send('article_reading_time', { reading_milestone: seconds });
        sent.add(key);
      }
    }
    // Only count a milestone while its position is visible. Jumping down the
    // page does not award the skipped intermediate milestones.
    for (const percent of [25, 50, 75, 100]) {
      const point = start + (finish - start) * percent / 100;
      if (point >= 0 && point <= height && !sent.has(percent)) {
        send('article_progress', { article_percent: percent });
        sent.add(percent);
      }
    }
  }
  window.setInterval(sample, 1000);
})();
