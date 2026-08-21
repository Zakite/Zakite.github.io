# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`Zakite.github.io` — Zak Jibrin's academic homepage (PhD candidate, Earth and Planetary Sciences, Rutgers) on GitHub Pages. Pure static files served verbatim: a `.nojekyll` at the root disables the Jekyll pipeline entirely. There is no build step, bundler, framework, test suite, or linter.

The live pages and what they use:

- [index.html](index.html) — the homepage. Single self-contained file; all CSS and JS inline.
- [cv.html](cv.html) — CV, rendered live from a link-shared Google Doc on every load via [gdoc.js](gdoc.js) (no caching, no commit; falls back to a plain link to the doc if the fetch fails).
- [piece.html](piece.html) — one page for every piece of writing (`piece.html?id=<key>`); keys and doc IDs live in [pieces.js](pieces.js), which also decides which entries on the homepage's Writing list become links. Uses the same `gdoc.js` reader as the CV — one copy to keep correct.
- [404.html](404.html) — self-contained static not-found page in the site palette.
- `zak_rover.jpg` — the About photo and the `og:image`. It shows **Curiosity** (the Namib Dune selfie mural), not Perseverance; the caption says so deliberately.
- `bio/`, `tools/` — source assets and a dev helper script; not referenced by the live pages.

History note: the repo began as a fork of the "Revolve" Jekyll template (themefisher). All of that scaffolding (`_layouts/`, `_includes/`, `_data/`, `_posts/`, `_config.yml`, `about.html`, `contact.html`, `search.json`, `assets/`, `Gemfile`, template README/LICENSE) was deleted in 2026-08 because Pages was still building and serving the template's placeholder pages — including a 404 carrying the template author's social links. If a stray reference to any of those paths turns up, it is stale; don't resurrect them.

## Working on index.html

This is almost always where changes belong. Structure, top to bottom:

- Inline `<style>` block: CSS custom properties (`--bg`, `--ink`, `--accent`, `--oxy`, font stacks) drive the whole palette/typography. The page is authored large and scaled down via CSS `zoom` (a deliberate choice — see the comment at the top of the style block — don't replace with `transform: scale`, which would desync layout rects from what's on screen). The zoom is desktop-only (`@media (min-width: 901px)`): `0.6` on `html`, with a further `0.55` on the two `#cpa` panels (`.cpa-fig`, `.cpa-sim`). The page factor is chosen so body copy (`1.05rem` of the `23px` root) lands near 14.5px on screen; the panels are calibrated by eye at **33% overall**, so their factor is always `0.33 / <page factor>` and must be recomputed whenever the page factor changes. The phone breakpoints (≤900/600/400px) re-tune the root font size as final rendered sizes and must never have zoom stacked on them.
- `<nav>` → `<header class="hero" id="hero">` → `<section id="about">` → `<section id="research">` → `<section id="writing">` → `<section id="cpa">` → `<section id="elsewhere">` → `<footer>` → coda/epigraph.
- Several independent inline `<script>` blocks at the bottom, each IIFE-wrapped and null-guarded (`if (!el) return;`) so they no-op safely if their DOM isn't present:
  - The G-tetrad/fibril hero animation (pointer-tilt 3D CSS, builds a helical stack of "plates" as DOM siblings).
  - The `#cpa` figure's SVG `<animateMotion>` particle paths, gated by `IntersectionObserver` (frozen via `pauseAnimations()` until scrolled into view).
  - A "secret" click-to-swap Easter egg on the "Z" in the logo.
  - A canvas-based (`#csCanvas`) crystallization-by-particle-attachment simulation staged after three papers (Avaro 2023 J Phys Chem Lett; Smeets 2015 Nat Mater; Zhang & Xu 2013 J Struct Biol): ions → transient prenucleation clusters → organic-matrix binding → dense-liquid globules densifying to ACC → amorphous nanogranular packing of the tablet → in-place crystallization with grain-to-grain spread and rotation-into-registry fusion → the fixed cinematic tail (platelet → stacked nacre → abalone shell). Verify changes headlessly via the `window.__cs` hook (advance/reset/render/state); there is no stats panel or slider, only Pause/Restart buttons and the stage list.
  - The Writing-list wiring that reads `pieces.js` and turns published entries into `piece.html?id=` links.
- All scripts respect `prefers-reduced-motion: reduce` and gate pointer-driven effects on `pointer: fine`. Preserve this when editing.

## Outside dependencies (can break without a commit)

The CV and writing pages fetch Google Docs HTML exports client-side. That depends on (1) each doc staying link-shared ("anyone with the link" → Viewer) and (2) Google continuing to send permissive CORS headers on the export endpoint — undocumented behaviour, not an API. Both pages degrade to a plain link to the doc on failure.

## Local preview

Open any page directly in a browser, or serve the directory statically (e.g. `python -m http.server`). Note the Google-Docs fetch on `cv.html`/`piece.html` needs an http(s) origin in some browsers; `file://` may fall back to the error link.
