const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('article-analytics.js', 'utf8');

function fixture(home = false) {
  const events = [];
  const state = { start: 0, finish: 4000, now: 0, consent: true, focused: true };
  const heading = { textContent: 'Article title', getBoundingClientRect: () => ({ bottom: state.start }) };
  const end = { getBoundingClientRect: () => ({ top: state.finish, bottom: state.finish }) };
  const latest = { dataset: { commentsPost: '/posts\\example\\index.html' }, querySelector: () => heading, lastElementChild: end };
  const document = {
    body: { classList: { contains: () => !home } },
    querySelector: selector => selector.startsWith('.latest-post') ? (home ? latest : null)
      : selector === '#title-block-header' ? heading : end,
    get cookie() { return 'cookie_consent_level=' + encodeURIComponent(JSON.stringify({ tracking: state.consent })); },
    visibilityState: 'visible', hasFocus: () => state.focused,
    addEventListener: (_, handler) => { state.click = handler; },
  };
  const window = { innerHeight: 1000, gtag: (...args) => events.push(args), setInterval: callback => { state.sample = callback; } };
  vm.runInNewContext(source, { document, window, location: { pathname: home ? '/' : '/posts/example/index.html', hash: '' }, performance: { now: () => state.now } });
  state.tick = () => { state.now += 1000; state.sample(); };
  return { state, events, document };
}

test('consent and focused tab are required; revocation stops events', () => {
  const { state, events, document } = fixture();
  state.consent = false;
  state.tick();
  state.consent = true;
  state.focused = false;
  state.tick();
  document.visibilityState = 'hidden';
  state.focused = true;
  state.tick();
  assert.equal(events.length, 0);
  document.visibilityState = 'visible';
  state.tick();
  assert.equal(events[0][1], 'article_progress');
  state.consent = false;
  state.start = -3000; state.finish = 1000;
  state.tick();
  assert.equal(events.length, 1);
});

test('home and article use one identity; progress is once per visible milestone', () => {
  for (const home of [false, true]) {
    const { state, events } = fixture(home);
    state.tick(); state.tick();
    state.start = -2000; state.finish = 2000;
    state.tick();
    const progress = events.filter(event => event[1] === 'article_progress');
    assert.deepEqual(progress.map(event => event[2].article_percent), [25, 50, 75]);
    assert.equal(progress[0][2].article_path, '/posts/example/');
    assert.equal(progress[0][2].article_placement, home ? 'home' : 'article');
  }
});

test('comment jump does not award skipped progress or reading time', () => {
  const { state, events } = fixture();
  state.click({ target: { closest: () => true } });
  state.start = -3000; state.finish = 1000;
  for (let i = 0; i < 65; i++) state.tick();
  assert.deepEqual(events.map(event => event[1]), ['article_comments_jump']);
  state.start = 0; state.finish = 4000;
  state.tick();
  assert.equal(events.at(-1)[1], 'article_progress');
});

test('reading time milestones exclude off-article time and are not duplicated', () => {
  const { state, events } = fixture();
  for (let i = 0; i < 61; i++) state.tick();
  assert.deepEqual(events.filter(event => event[1] === 'article_reading_time').map(event => event[2].reading_milestone), [30, 60]);
  state.start = -5000; state.finish = -1000;
  for (let i = 0; i < 70; i++) state.tick();
  assert.equal(events.filter(event => event[1] === 'article_reading_time').length, 2);
});
