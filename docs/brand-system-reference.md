---
title: Agent Farm brand system reference
description: Adopted design-system spec for the Agent Farm identity — typography, color, and wordmark rules for implementers.
---

# Agent Farm brand system reference

Built as a proper design system, not "whatever the AI drew." Source: Sahil Shingate, 2026-07-11 (brand board + spec). Status: adopted.

## Typography

### Primary — wordmark

**Space Grotesk** — chosen for infrastructure software.

| Token | Weight | Tracking | Fill |
|---|---|---|---|
| `Agent` | 700 | -0.03em | foreground colour |
| `Farm` | 700 | -0.03em | gradient `#5B7CFF → #8A6BFF → #C85ED8` |

- `Farm` uses the gradient fill in colour contexts; use a single colour when the wordmark is monochrome.

### Secondary — byline

`BY AGENSIS`

| Property | Value |
|---|---|
| Font | Inter |
| Weight | 500 |
| Size | 12px |
| Tracking | 0.42em |
| Opacity | 55% |

## Gradient reference

The brand gradient is a three-stop left-to-right ramp:

```
#5B7CFF → #8A6BFF → #C85ED8
```

Use it for the `Farm` wordmark fill and as the primary accent gradient across identity assets (logo layering, animation).

## Implementation notes

- Hand this spec to a UI developer as-is; do not re-derive values by eye from renders.
- When adding new surfaces (logo assets, SVG layering, animation, icons), extend from these primitives rather than introducing new fonts or colours.