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
