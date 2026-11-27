# Uhlaka's logo

The UH monogram, chosen by David on 2026-11-27 ([ADR 0080](../docs/adr/0080-the-logo.md)).
A U and an H drawn in thin parallel lines: the right arm of the U is the left
post of the H, as the frame holds the structure.

| File | What it is |
|---|---|
| `uhlaka.svg` | The logo: the mark on its black tile. The main one. |
| `uhlaka-mark.svg` | The mark alone, for a dark background. |
| `uhlaka-icon-16.svg` | A separate drawing for 16 px (a browser tab): only the U and the H, in strokes of 2 px, because the parallel lines run together that small. |
| `uhlaka-atelier.svg`, `uhlaka-atelier-mark.svg`, `uhlaka-atelier-icon-16.svg` | The same three in the Atelier colours, for uhlaka.org and next to the Atelier theme. |

## Colours

| | Original | Atelier |
|---|---|---|
| Tile | `#0c0c0a` | `#2337a8` |
| U | `#f9fefe` | `#ffffff` |
| H and the inner lines | `#287df0` | `#ffd24d` |

Lines are 11 units thick on a 404-unit tile (scaled to a 512 viewBox), with
square ends. Next to the name, the name is set in Bricolage Grotesque 800
(`fonts/`), tracking −0.035 em.

## Using it

- Below 32 px, use the `-icon-16` drawing, not a scaled-down logo.
- On a dark background the black tile almost disappears: use the mark alone,
  or the Atelier version.
- Do not redraw, recolour or stretch it. The files are the reference.
