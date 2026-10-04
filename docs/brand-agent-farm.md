---
title: Agent Farm brand system
description: The design-system spec for the Agent Farm identity — typography, colours, logo assets, SVG layering, animation, and icon guidance. Hand this to a UI developer as-is.
status: adopted
source: Sahil Shingate, 2026-07-11 (brand board + spec)
---

# Agent Farm — brand system

> Built as a proper design system rather than "whatever the AI drew".

## Typography

### Primary — wordmark

**Manrope** — chosen over Space Grotesk (Sahil Shingate, 2026-07-11).

- `Agent` — weight **700**, tracking **-0.03em**, foreground colour.
- `Farm` — weight **700**, gradient fill:

```
#5B7CFF → #8A6BFF → #C85ED8
```

Single colour when monochrome.

### Secondary — byline

`BY AGENSIS`

| Property | Value |
|---|---|
| Font | Inter |
| Weight | 500 |
| Size | 12px |
| Tracking | 0.42em |
| Opacity | 55% |

## Sizes

| Context | Wordmark | Subtitle | Icon | Gap |
|---|---|---|---|---|
| Desktop / hero | 64px | 12px | 56×56 | 24px |
| Sidebar | 24px | omitted | 32×32 | — |
| Navbar | 22px | 10px | 28px | — |

## Colours

| Name | Value |
|---|---|
| Primary (ink) | `#0F1115` |
| Purple | `#5C7CFA` |
| Accent | `#8C6CFF` |
| Pink | `#D96CE6` |
| Grey | `#8E9198` |
| Background (light) | `#F7F7F9` |
| Background (dark) | `#0E1117` |

## Logo assets

1. `logo-horizontal.svg` — [icon] Agent Farm / BY AGENSIS
2. `logo-horizontal-dark.svg` — white text, dark background
3. `logo-stacked.svg` — icon over wordmark over byline
4. `icon.svg` — just the barn
5. `icon-outline.svg` — stroke only
6. `icon-filled.svg` — solid
7. `favicon.svg` — simplified
8. `icon-app-1024.png` — rounded square

## Brand assets

- **Barn** — transparent PNG + SVG
- **Compute fields** — transparent SVG; can animate independently
- **Trees** — separate asset, optional
- **Wordmark** — transparent SVG, no icon
- **Subtitle** — separate SVG

## SVG layers

```
barn.svg
fields.svg
compute_nodes.svg
trees.svg
gradient-mask.svg
```

Layered files make animation easy.

## Animation

- **Hover** — fields illuminate
- **Nodes** — pulse
- **Barn** — tiny 1px rise, shadow increases
- **Gradient** — slow 12-second shift

## UI icon set

One visual language: every icon shares the logo's stroke width and rounded
geometry. **NO EMOJI — ever.** The list below names concepts, not glyphs;
each must be drawn (lucide-compatible stroke style):

Dashboard · Farms · Profiles · Silos · Tools · Worktrees · Usage ·
Running · Stopped · Refresh · Deploy · Harvest · Network · Skills · Agents

## Icon simplification (the one change from the generated concept)

The current mark is ~90% there but still too detailed for a brand mark.
Reduce to:

- a **single barn silhouette**, no windows except one simple square,
- **three** compute lanes instead of five,
- **three** connection nodes,
- **no trees**.

That icon works at 16, 24, 32, 48 and 1024px without losing recognition,
still reads as both a **farm** and an **orchestration platform**, and sits
closer to the simplicity of Docker/Kubernetes/Vercel/GitHub marks.
