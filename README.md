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

Add each published article to the list in `_includes/footer.html`, using the
existing entry as a template. This one list appears on every page. Keep
`index.qmd` as the short blog introduction and edit your biography in `about.qmd`.

Build all pages before publishing:

```powershell
quarto render
```

## Publish

Commit and push to `main`. `.github/workflows/publish.yml` renders and deploys to GitHub Pages. In repository Settings → Pages, the source must be **GitHub Actions**.

Live site: https://sailinginunnecessarydetail.com/

## CFD figures

The first article uses the saved `trimmed_3d_v2` dataset. Its `provenance.json`
records the source hashes, weighting method and hashes of all six figures.
The three 3D screenshots use author-framed browser views; their camera, viewport
and capture details are saved in the corresponding `*.capture.json` files.
The SVG colour mesh is rasterised; text, outlines and contours remain vectors.
Rendering the blog requires no solver, Python environment or CFD data.

The wind-effect maps use a linearisation of an interpolated 2019 ORC X-332
polar at 5 m/s true wind and 41 degrees TWA, expressed as a percentage of the
reference upwind VMG while holding course. The apparent-wind perturbations are
converted to true-wind perturbations before applying the derivatives. The
source table and coefficient details are included alongside the article.

To regenerate the percentage maps from saved CFD caches:

```powershell
python scripts/export_orc_maps.py --cfd-root ../ob
```

This only post-processes saved scalar fields and starts no simulation. A matching
3D percentage viewer is written under `cfd/output/trimmed_3d_v2/orc_percent` in
the CFD repository. Its article screenshot is captured after author framing.
