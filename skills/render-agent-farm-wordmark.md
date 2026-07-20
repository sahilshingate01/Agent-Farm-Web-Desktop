---
name: render-agent-farm-wordmark
description: Build the Agent Farm wordmark (Space Grotesk + gradient) and BY AGENSIS byline with the adopted brand tokens, in colour or monochrome contexts
---

# Render the Agent Farm wordmark

The Agent Farm identity is an **adopted design system**, not "whatever the AI drew" (`docs/brand-system-reference.md`, `docs/brand-agent-farm.md`). Use these exact tokens whenever you place the wordmark in a UI surface, splash, or asset.

/

## Primary wordmark

**Font: Space Grotesk.** The wordmark is two spans:

| Token   | Weight | Tracking  | Fill |
|---------|--------|-----------|------|
| `Agent` | 700    | `-0.03em` | foreground colour |
| `Farm`  | 700    | `-0.03em` | brand gradient |

- **Brand gradient** (three-stop, left-to-right): `#5B7CFF → #8A6BFF → #C85ED8`.
- In **colour** contexts, `Farm` uses the gradient fill. In **monochrome** contexts, render the whole wordmark in a single colour.

Example (React/Tailwind-ish sketch):

```tsx
<span className="font-[Space_Grotesk] font-bold tracking-[-0.03em]">
  <span className="text-foreground">Agent</span>
  <span className="bg-gradient-to-r from-[#5B7CFF] via-[#8A6BFF] to-[#C85ED8] bg-clip-text text-transparent">
    Farm
  </span>
</span>
```

## Secondary byline

`BY AGENSIS`:

| Property | Value |
|----------|-------|
| Font     | Inter |
| Weight   | 500   |
| Size     | 12px  |
| Tracking | 0.42em |
| Opacity  | 55%   |

## Notes

- **Space Grotesk is a redistributed font** — if you bundle it, it carries its own license and reserved-name rules, separate from the app's GPL. See the redistributed-font convention and `docs/license-compliance-inventory.md` before shipping it.
- Keep tracking and weights exact; the negative `-0.03em` tracking is part of the adopted spec, not a suggestion.

