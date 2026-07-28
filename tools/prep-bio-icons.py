#!/usr/bin/env python3
"""
Turn the supplied biomineral pictures into nav icons.

Run once, by hand, whenever a source picture changes:

    python tools/prep-bio-icons.py

This is not part of building the site. The site has no build step; this only
prepares image assets, and its output is committed like any other asset.

    reads   bio/src/<name>.<ext>     whatever was supplied, any format
    writes  bio/<name>.png           transparent, ready to use

Two treatments, because the sources are two different kinds of picture:

  SILHOUETTE  A flat drawing: dark shape, white or transparent ground.
              The output keeps only an alpha channel -- the shape's coverage,
              with its antialiased edge intact -- and is pure white
              everywhere it is opaque. Nothing carries colour, because the
              page colours it: CSS uses these with mask-image, so the icon
              takes the accent from the stylesheet and can change on hover
              or with the theme without touching the file. Any white inside
              the subject (the septa in the nautilus, the pores in the
              coral) drops out too, which is what makes those read as
              cut-outs rather than as flat blobs.

  MICROGRAPH  A real photograph, with tone worth keeping. Flattening it to a
              silhouette would throw away the very detail that makes it worth
              using, so instead the subject is cut out on a circle and the
              greys are mapped onto two colours from the site palette. The
              result is an ordinary image, not a mask.
"""

import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'bio', 'src')
OUT = os.path.join(ROOT, 'bio')

# Duotone endpoints for the micrograph, taken from the site's own palette:
# the page's recessed panel colour and the verdigris accent.
DARK = np.array([16, 22, 30], dtype=float)      # --bg
LIGHT = np.array([120, 240, 228], dtype=float)  # a lift above --accent #3FD9CB

JOBS = {
    # name          treatment       notes
    'trilobite':   {'mode': 'silhouette'},
    'nautilus':    {'mode': 'silhouette'},
    'coral':       {'mode': 'silhouette'},
    'coccolith':   {'mode': 'micrograph', 'circle': 0.94},
}

SIZE = 256   # generous: the icon renders at 42px, and retina wants the headroom


def load(name):
    for ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'):
        p = os.path.join(SRC, name + ext)
        if os.path.exists(p):
            return Image.open(p).convert('RGBA'), p
    return None, None


def silhouette(img):
    """Alpha = how much of the subject covers each pixel; colour = white."""
    a = np.asarray(img, dtype=float) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]

    # Luminance. A drawing is dark on light, so coverage is the inverse.
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    coverage = 1.0 - lum

    # Where the source already has transparency, honour it: a cut-out PNG
    # says exactly what is subject and what is not, and guessing from colour
    # would only undo that.
    if alpha.min() < 0.99:
        coverage = coverage * alpha + (1.0 - alpha) * 0.0
        coverage = np.clip(coverage / max(coverage.max(), 1e-6), 0, 1)
        # a hard-alpha cut-out carries its shape in alpha, not in tone
        if np.median(coverage[alpha > 0.5]) < 0.15:
            coverage = alpha

    # Stretch so the darkest ink is fully opaque and paper is fully clear.
    lo, hi = np.percentile(coverage, 2), np.percentile(coverage, 99.5)
    if hi - lo < 1e-6:
        raise SystemExit('  ! image looks blank after background removal')
    coverage = np.clip((coverage - lo) / (hi - lo), 0, 1)

    out = np.zeros(a.shape, dtype=np.uint8)
    out[..., :3] = 255                      # white: the mask carries no colour
    out[..., 3] = (coverage * 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def micrograph(img, circle=0.94):
    """Cut the subject out on a circle and map its greys onto the palette."""
    img = crop_square(img)
    a = np.asarray(img, dtype=float) / 255.0
    lum = a[..., :3] @ np.array([0.2126, 0.7152, 0.0722])

    lo, hi = np.percentile(lum, 3), np.percentile(lum, 97)
    t = np.clip((lum - lo) / max(hi - lo, 1e-6), 0, 1)[..., None]
    rgb = DARK * (1 - t) + LIGHT * t

    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - (h - 1) / 2.0, xx - (w - 1) / 2.0) / (min(h, w) / 2.0)
    # soft edge, so the cut-out does not read as a sticker
    alpha = np.clip((circle - r) / 0.06, 0, 1)

    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = rgb.astype(np.uint8)
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def crop_square(img):
    w, h = img.size
    s = min(w, h)
    return img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def trim(img):
    """Drop fully transparent margin so every icon fills its box equally."""
    bbox = img.split()[3].getbbox()
    return img.crop(bbox) if bbox else img


def fit(img, size=SIZE):
    """Letterbox into a square without distorting the subject."""
    img = trim(img)
    w, h = img.size
    scale = (size * 0.96) / max(w, h)
    img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    canvas.paste(img, ((size - img.size[0]) // 2, (size - img.size[1]) // 2), img)
    return canvas


def main():
    os.makedirs(OUT, exist_ok=True)
    if not os.path.isdir(SRC):
        sys.exit('No %s -- put the source pictures there first.' % SRC)

    missing, done = [], []
    for name, job in JOBS.items():
        img, path = load(name)
        if img is None:
            missing.append(name)
            continue
        print('%-11s <- %s  %s' % (name, os.path.basename(path), img.size))
        if job['mode'] == 'silhouette':
            out = silhouette(img)
        else:
            out = micrograph(img, job.get('circle', 0.94))
        out = fit(out)
        dest = os.path.join(OUT, name + '.png')
        out.save(dest, optimize=True)
        print('%-11s -> bio/%s.png  %s' % ('', name, out.size))
        done.append(name)

    if missing:
        print('\nstill waiting on: ' + ', '.join(sorted(missing)))
        print('drop them in bio/src/ as <name>.<any image extension>')
    if done:
        print('\nwrote %d icon(s).' % len(done))


if __name__ == '__main__':
    main()
