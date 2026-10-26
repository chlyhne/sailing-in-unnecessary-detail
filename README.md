# Sailing in Unnecessary Detail

An English-language Quarto blog about sailing, fluid dynamics and simulation.

## Local preview

Install Quarto 1.8.27 or newer, open this directory in a terminal, then run:

```powershell
quarto preview
```

## Write a post

Create `posts/your-post/index.qmd` with a title, description, explicit date and categories in its YAML header. Place its figures alongside it. Use `$...$` for inline mathematics and `$$...$$` for display equations. Use SVG for vector figures. Set `draft: true` while writing; remove it when ready to publish. The index and RSS feed update automatically.

Build all pages before publishing:

```powershell
quarto render
```

## Publish

Commit and push to `main`. `.github/workflows/publish.yml` renders and deploys to GitHub Pages. In repository Settings ? Pages, the source must be **GitHub Actions**.

Live site: https://chlyhne.github.io/sailing-in-unnecessary-detail/

## CFD figures

The first article uses the saved marine_3d_padded_5ms dataset. Its `provenance.json` records the source hash and weighting method. The SVG colour mesh is rasterised; text, outlines and contours remain vectors. Rendering the blog requires no solver, Python environment or CFD data.
