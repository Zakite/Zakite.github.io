# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`Zakite.github.io` — a GitHub Pages site. It contains two unrelated things layered on top of each other:

1. **The real, live site**: [index.html](index.html), a single self-contained static HTML file (Zak Jibrin's academic homepage — PhD candidate, Earth and Planetary Sciences, Rutgers). All CSS and JS live inline in this one file; there is no build step, bundler, or framework.
2. **Unused Jekyll theme scaffolding**: `_layouts/`, `_includes/`, `_data/`, `_posts/`, `_config.yml`, `about.html`, `contact.html`, `404.html`, `search.json`. This is the forked "Revolve" template (themefisher) the repo started from. These pages still carry Jekyll front matter and Bootstrap markup, and still contain the template's placeholder Lorem-Ipsum content (fake bios, `rubel8525` social links, etc.) — they are not linked from `index.html` and are not part of the real site. Treat them as legacy/dead unless a task specifically targets Jekyll.

**The critical fact that explains the whole repo**: `index.html` has **no Jekyll front matter** (no leading `---` block). That means GitHub Pages'/Jekyll's build simply copies it through verbatim as a static file — none of `_layouts`, `_includes`, or `_data` apply to it. Everything the homepage needs must be inline in `index.html` itself. Any other page still using front matter (`about.html`, `contact.html`, `404.html`, files under `_posts/`) *does* go through the Jekyll layout/include pipeline.

## Working on index.html

This is almost always where changes belong. Structure, top to bottom:

- Inline `<style>` block: CSS custom properties (`--bg`, `--ink`, `--accent`, `--oxy`, font stacks) drive the whole palette/typography. The page is authored at a base font size and then globally scaled via `zoom: 0.7` on `:root` (a deliberate choice — see the comment at the top of the style block — don't replace with `transform: scale`).
- `<nav>` → `<header class="hero" id="hero">` → `<section id="about">` → `<section id="research">` → `<section id="writing">` → `<section id="cpa">` → `<section id="elsewhere">` → `<footer>`.
- Several independent inline `<script>` blocks at the bottom, each IIFE-wrapped and null-guarded (`if (!el) return;`) so they no-op safely if their DOM isn't present:
  - The G-tetrad/fibril hero animation (pointer-tilt 3D CSS, builds a helical stack of "plates" as DOM siblings).
  - The `#cpa` figure's SVG `<animateMotion>` particle paths, gated by `IntersectionObserver` (frozen via `pauseAnimations()` until scrolled into view).
  - A "secret" click-to-swap Easter egg on the "Z" in the logo.
  - A canvas-based (`#csCanvas`) crystallization-by-particle-attachment simulation (amorphous-nanoparticle aggregation → crystalline front propagation), with a live stats panel and a "stabilisation" slider.
- All scripts respect `prefers-reduced-motion: reduce` and gate pointer-driven effects on `pointer: fine`. Preserve this when editing.

## Known stale/missing references (don't "fix" without asking — may be intentional placeholders)

- `og:image` meta tag points to `zak.jpg`, but the only image at repo root is [zak_rover.jpg.jpg](zak_rover.jpg.jpg).
- The `#cpa` section references `cpa.jpg`, which does not currently exist at repo root.
- `cv.pdf` (linked from `#elsewhere`) does not exist at repo root.
- Two links are still literal placeholders: Google Scholar (`?user=REPLACE_ME`) and GitHub (`github.com/REPLACE_ME`).

## Local preview

No build step for `index.html` — open it directly in a browser, or serve the directory statically (e.g. `python -m http.server`).

To preview the legacy Jekyll pages instead: `bundle install` then `bundle exec jekyll serve` (Gemfile pins `jekyll`, `jekyll-feed`, `jekyll-paginate-v2`, `jekyll-tagging`, `jekyll-archives`, `webrick`). There is no test suite and no linter configured in this repo.
