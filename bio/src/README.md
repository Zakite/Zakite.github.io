# Source pictures for the nav biominerals

Drop the originals here, named exactly as below. Any common image format
works (`.png`, `.jpg`, `.webp`, …) — the extension does not matter, only the
name before it.

| file | picture | used for |
|---|---|---|
| `trilobite.*` | trilobite silhouette | About |
| `coccolith.*` | coccolithophore SEM micrograph | Research |
| `nautilus.*`  | nautilus shell | Writing |
| `coral.*`     | branching coral | Elsewhere |

Then run, from the repo root:

```bash
python tools/prep-bio-icons.py
```

That writes `bio/<name>.png`: transparent, trimmed, square, and either a
colourless mask (the drawings, so the stylesheet can colour them) or a
duotoned cut-out (the micrograph, so its tone survives). See the comment at
the top of the script for why the two are treated differently.

Both these originals and the generated icons are committed. Keep the
originals so the icons can be regenerated if the palette changes.

**Note on rights:** these are whatever you supplied. The SEM micrograph in
particular is the kind of image that usually belongs to a lab, a journal or a
stock library, so it is worth being sure you have permission to publish it —
the site is public, and an icon is still a use.
