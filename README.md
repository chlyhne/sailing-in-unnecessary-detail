# Sailing in Unnecessary Detail

An English-language Quarto notebook about sailing, fluid dynamics and simulation.
The site has a short introduction, an About page and article pages, with a
shared article index on the right and a small stylesheet.

## Local preview

Install Quarto 1.8.27 or newer, open this directory in a terminal, then run:

```powershell
quarto preview
```

## Write a post

Create `posts/your-post/index.qmd` with a title and explicit date in its YAML
header. Place its figures alongside it. Use `$...$` for inline mathematics and
`$$...$$` for display equations. Set `draft: true` while writing; remove it when
ready to publish. Add a link back to `../../index.qmd` in the post.

The article index is generated from post titles and dates. It appears on every
page, as a sidebar on desktop and a collapsed Articles menu on phones.
The home page automatically appends the full newest published post below the
introduction, selected by its `date` (use `YYYY-MM-DD`). Posts with `draft: true`
are excluded. Keep `index.qmd` as the short blog introduction and edit your
biography in `about.qmd`.

Build all pages before publishing:

```powershell
quarto render
```

## Publish

Commit and push to `main`. `.github/workflows/publish.yml` renders and deploys to GitHub Pages. In repository Settings → Pages, the source must be **GitHub Actions**.

Live site: https://sailinginunnecessarydetail.com/

## Drafts and owner sign-in

There is one site build, hosted on GitHub Pages. Posts with `draft: true` are
rendered using Quarto's `draft-mode: unlinked`: anyone with a direct URL can
read them, but they are absent from the ordinary article index and sitemap.

Use the footer's **Owner sign-in**, sign in with the existing GitHub app as
`chlyhne`, then select **Back to the blog**. The blog remembers owner view in
local storage until the login's expiry time. Drafts appear in the article list,
and the newest draft appears on the home page when newer than published posts.
The draft banner is hidden in owner view. Signing out returns to the blog and
clears owner view.

Owner view is a presentation preference, not an access restriction. The browser
flag can be changed manually. Comment deletion still requires a verified owner
session and CSRF token on the Worker. No new credentials are needed.

Draft changes use the same `git push origin main` deployment as published posts.
Remove `draft: true` to publish a post; the article index updates automatically.
The comments Worker serves the API and login only and has no site assets.

## Visitor analytics

Google Analytics 4 is configured in `_quarto.yml` with measurement ID
`G-87VVYGWHG8`. Quarto includes the tag on every page. Tracking starts only
after the visitor accepts analytics cookies; the footer's **Cookie preferences**
link lets them change their choice.

In Google Analytics, select a calendar month and use **Total users** for the
monthly unique-user estimate. Use **Realtime** to check that data is arriving
after accepting analytics cookies on the live site. Visitors who decline
tracking or block the tag will not be included.

### Article reading reports

`article-analytics.js` sends these GA4 events only while tracking consent is
currently granted. Home-page and standalone readings share `article_path`,
with `article_placement` distinguishing `home` from `article`:

- `article_progress`: a 25%, 50%, 75%, or 100% position is visible during a
  focused-tab sample (`article_percent`). Each milestone fires once per page
  load; scrolling past a position between samples does not count it.
- `article_reading_time`: 30, 60, 120, 300, or 600 seconds accumulated with
  the article in view and the tab visible and focused (`reading_milestone`).
- `article_comments_jump`: the reader clicks **Jump to comments**. Progress
  and article time pause until the reader returns above the end of the article.

All events include `article_path`, `article_title`, `article_placement`, and
cumulative `reading_seconds`. These are indicators of reading, not proof of
completion. Notes and comments are outside the measured article body.
No events are queued for visitors who decline tracking. Data begins with this
change; earlier reading progress cannot be reconstructed.

In GA4, open **Admin ? Custom definitions** and create event-scoped dimensions
for `article_path`, `article_title`, `article_placement`, `article_percent`,
and `reading_milestone`. Create a custom metric for `reading_seconds` with
seconds as its unit. This cumulative value is best inspected per milestone;
do not sum it across all events as total reading time.
See [Google's event parameter documentation](https://developers.google.com/analytics/devguides/collection/ga4/event-parameters).

Use **Realtime** to check incoming events after accepting analytics cookies.
In **Explore**, compare total users by `article_path`, event name, and progress
percentage; filter placement to distinguish the home page from article pages.
Custom definitions may take up to 48 hours to become available in reports.
The default GA scroll event remains a separate page-level measurement.

Run the tracking checks with `node --test test/article-analytics.test.cjs`.

## Comments

Every post has a comment form with a name and plain-text comment. Comments
are stored in the blog's own Cloudflare D1 database through `comments-api/`;
readers do not need an account or email address. The newest post on the home
page shows the same comment thread as its article page, with comments above
the new-comment form. A link near the article title jumps to the comments. Titles can change without losing comments.

The footer has a **Manage comments** link for owner-only GitHub sign-in and
comment deletion. One-time OAuth app setup and Worker secrets are required;
see [owner setup](comments-api/README.md#owner-only-comment-management).

See [comments-api/README.md](comments-api/README.md) for local preview,
deployment, comment removal and database backups.

## CFD figures

The first article uses the saved `trimmed_3d_v2` dataset. Its `provenance.json`
records the source hashes, weighting method and hashes of all six figures.
The three 3D screenshots use author-framed browser views; their camera, viewport
and capture details are saved in the corresponding `*.capture.json` files.
The SVG colour mesh is rasterised; text, outlines and contours remain vectors.
Rendering the blog requires no solver, Python environment or CFD data.

The combined wind-effect map uses a linearisation of an interpolated 2019 ORC X-332
polar at 5 m/s true wind and 41 degrees TWA, expressed as a percentage of the
reference upwind VMG while holding course. The apparent-wind perturbations are
converted to true-wind perturbations before applying the derivatives. The
source table and coefficient details are included alongside the article.
The separate wind maps show ΔTWS in knots and ΔTWA in degrees; the combined
map keeps the VMG-based percentage scale. Red is less wind or a header; blue
is more wind or a lift.

To convert existing percentage component SVGs and export matching PNGs
without the CFD caches (requires Inkscape):

```bash
python scripts/export_true_wind_maps.py
```

To regenerate the percentage maps from saved CFD caches:

```powershell
python scripts/export_orc_maps.py --cfd-root ../ob
```

This only post-processes saved scalar fields and starts no simulation. A matching
3D percentage viewer is written under `cfd/output/trimmed_3d_v2/orc_percent` in
the CFD repository. Its article screenshot is captured after author framing.
The exporter also uses Inkscape to save the separate maps in true-wind units.

The sail close-up uses a separate 2D calculation at the saved
`trimmed_reference_v2` trim and the representative height of 4.52 m. To
re-export it from an existing, checked solution without running a solver:

```bash
python scripts/export_trim_closeup.py --cfd-root ../Onsdagsbanen --case ../Onsdagsbanen/cfd/cases/blog_trimmed_reference_v2
```

Its colours show static pressure relative to the undisturbed wind in pascals:
blue is lower pressure and red is higher pressure. Arrows show solved air
velocity. The pressure conversion is checked against SU2's surface pressure
coefficients. Geometry, numerical checks and source hashes are recorded in
the article's `provenance.json`.

The lee-bow diagram embeds the unmodified 😎 and 😞 artwork from
[Twemoji](https://github.com/jdecked/twemoji), by Twitter, Inc. and contributors,
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Sail-mode figures

The blog uses a separate crossover example: a single A-to-B leg at the angle
where jib and gennaker have equal speed, with gennaker chosen as the direct
baseline. The note still uses its original two-bridge, two-leg example through
the unchanged `main()` calls. Regenerate the blog figures with transparent
backgrounds from the `random simuleringer` directory with:

```sh
PYTHONPATH=scripts .venv/bin/python - <<'PY'
import sail_change as figures
figures.plt.rcParams['savefig.transparent'] = True
sails, _ = figures.steady_example()
leg = figures.crossover_leg(sails)
figures.draw_crossover_intro(sails)
figures.draw_construction(sails, course=leg['bearing'])
figures.draw_course(leg)
PY
```

From the blog root, export the web figures:

```sh
pdftocairo -svg '../../random simuleringer/plots/sail_change_crossover_intro.pdf' posts/dont-always-lay-the-mark/sail-change-crossover-intro.svg
pdftocairo -svg '../../random simuleringer/plots/sail_change_between_sails.pdf' posts/dont-always-lay-the-mark/sail-change-between-sails.svg
pdftocairo -svg '../../random simuleringer/plots/sail_change_crossover_leg.pdf' posts/dont-always-lay-the-mark/sail-change-crossover-leg.svg
```

The post's `provenance.json` records source and figure hashes. The blog ships
the exported SVGs, so rendering requires no simulation environment.

The generator colours both main tracks in the blog's single-leg figure by
the difference between the boats' straight-line distances to B at the same
time, in hull lengths. Blue is closer to B, red is farther away, and black
means equal distances. Colours stay fixed after the first boat finishes.
The inset keeps its red/blue boat identifiers. The note's two-leg figure
continues to show the lead over the other boat in hull lengths.

Regenerate the time-weighted vector diagram with
`python scripts/export_mode_vectors.py` (requires NumPy and Matplotlib).
It reads the curves from `sail-change-crossover-intro.svg` and writes
`sail-change-mode-vectors.svg`, using equal time at two points on the jib polar.

## Onsdagsbanen odds dashboard

The dashboard is available directly at `odds.html`, with its navigation link
hidden until the season starts again. Choose your boat to compare with competitors
on handicap-corrected results. The course is inferred and the choice remembered.
Each matchup shows two sportsbook-style decimal prices: you to win and the
opponent to win (1 / probability), with the favourite subtly highlighted,
ordered closest to 50/50 first. Click an opponent for history, the actual
shared-finish record and an approximate
90% interval. Earlier races and model explanations are collapsed by default.

**The probability model is separate from redress.** It uses only 2025 and 2026
finishing orders from the same source CSV. A seasonal Plackett–Luce ranking model
is fitted after each race, with a joint Laplace posterior and cross-boat covariance.
Prior SD was selected using 2025 only; 2026 provides a prospective, later-season
evaluation. The 2025 curve is retrospective with respect to hyperparameter tuning.
DNF and attendance are not modeled; three finishes per boat are required.

See [method, validation and limitations](odds/validation.md). In particular,
observed validation improvement is not proof of precise probability calibration.
The redress implementation and its fitted states are unchanged.

The tracked `_data/odds/results.csv` supplies the input. To regenerate the odds
from that snapshot, from this website directory:

```bash
OPENBLAS_NUM_THREADS=1 ../Onsdagsbanen/.venv/bin/python scripts/export_odds.py
../Onsdagsbanen/.venv/bin/python -m unittest discover -s test -p 'test_ranking_odds.py'
node --test test/*.test.cjs
quarto render
```

`export_odds.py` accepts `--source`, `--config` and `--output`. NumPy and SciPy
are required only to regenerate data; the deployed site is static, with no
Python or backend dependency. The exporter hard-filters to 2025–2026, validates
finish times and records the source SHA256. Model tuning can be reproduced with
`Onsdagsbanen/scripts/evaluate_ranking_odds.py`; its output configuration is
copied to `odds/model-config.json` only when deliberately changing settings.

For browser QA, serve `_site/` on `127.0.0.1:8765`, then run:

```bash
PLAYWRIGHT_MODULE=/path/to/playwright node test/odds-browser.cjs
```

This checks the simple skipper flow, course inference, remembered boat,
expandable history/evidence, season/date selection, shared state, CSV download
and mobile overflow. Screenshots go to `/tmp/odds-simple-desktop.png` and
`/tmp/odds-simple-mobile.png`. Playwright is not a build dependency.

## Automatic Wednesday odds updates

The existing `Publish blog` workflow checks Manage2Sail at **19:17, 19:47,
20:17, 20:47, 21:17, 21:47, 22:17 and 22:47 on Wednesdays**, Copenhagen time.
The schedule is timezone-aware, including daylight saving. A second local-time
guard runs before any request; a 25-minute cooldown prevents closely queued
runs from repeatedly fetching. GitHub schedules are best-effort and may be late.

Visitors only download the site's static JSON. They never contact Manage2Sail.
Each check fetches the four configured class-result endpoints. Class IDs are
discovered once per week and cached. Conditional GET uses ETag/Last-Modified
when offered; the tested API currently supplies neither, so an unchanged check
still needs four JSON downloads. It does not fetch 2025 or run the redress
pipeline, generate result PDFs, or send emails.

Only normalized race data are compared: website metadata changes do not cause
a rebuild. New or corrected results must match across **two consecutive checks**
before a scheduled update. This gives at least one checking interval for the
sheet to settle; it is not a guarantee of an official final result. Missing
class data or missing previously published races stops the update and leaves
the existing site intact. Early absent rows for a later entrant are treated as
DNC, matching the original history collector. Stable Manage2Sail entry IDs keep
the existing canonical boat identities across name spelling changes.

On a confirmed change, the workflow installs the pinned model dependencies,
rebuilds the odds, runs tests, commits only the input snapshot, identity map and
output JSON, then deploys in the **same workflow**. This is intentional: commits
made with `GITHUB_TOKEN` do not trigger another push workflow. Unchanged results
skip model fitting, commits and deployment. Failed fits or tests never replace
the published snapshot. No new token, secret, server or paid scheduler is needed.

Files:

- `_data/odds/results.csv`: compact 2025–2026 input snapshot, initially seeded
  from the local redress history. The 2025 rows stay archived during 2026 polling.
- `_data/odds/identities.json`: stable entry IDs mapped to existing model names.
- `_data/odds/update-config.json`: event, four classes and polling window.
- `.cache/odds/`: ignored request cache and candidate data, persisted using
  GitHub Actions cache; losing the cache safely restarts the settling period.
- `scripts/refresh_odds.py`: network/checking logic, with no scientific dependencies.
- `scripts/odds-requirements.txt`: model dependency versions used for regeneration.

The current configuration is deliberately **2026 only**, respecting the
2025–2026 model scope. Automatic checks do not contact the old event in 2027.
Adding a new season requires an explicit model/data-scope update, not just a
silently invented event URL.

Nothing runs until these changes reach the repository's default branch.
After publishing, use **Actions → Publish blog → Run workflow → refresh_odds**
for an immediate manual check outside Wednesday evening. Manual mode bypasses
the time window, cooldown and settling delay, but keeps completeness checks.
Ordinary manual runs without that box simply publish the site as before.

Local commands, from the website directory:

```bash
# No network outside the configured window/year:
python3 scripts/refresh_odds.py

# Explicit immediate check; writes candidates only, does not publish:
python3 scripts/refresh_odds.py --force
```

For a locally checked candidate reported as changed:

```bash
OPENBLAS_NUM_THREADS=1 ../Onsdagsbanen/.venv/bin/python scripts/export_odds.py \
  --source .cache/odds/candidate.csv --output .cache/odds/data.json
```

The scheduler will miss corrections published outside its Wednesday window
until the next Wednesday; use the manual override when needed. GitHub may disable
public-repository schedules after 60 days of inactivity; re-enable the workflow
at season start if necessary.

References: [GitHub scheduling and timezones](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule),
[workflow token trigger behavior](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs).
