# ADR 0012 — Lexend over IBM Plex Sans for the UI typeface

**Status:** Accepted
**Date:** 2026-08-04

## Context

The app's UI typeface is set once, in [`--font-ui`](../../web/src/design/tokens.css). It was
originally **IBM Plex Sans**, chosen because it was drawn for technical interfaces and ships true
tabular figures — useful for a console full of readings and timestamps.

During the SCRUM-161 restyle, the priority that actually mattered on the target device surfaced:
**field readability on a bright screen, outdoors, read at a glance and sometimes one-handed.**
That is a legibility problem first and a "technical look" problem second.

| | IBM Plex Sans | Lexend |
|---|---|---|
| Designed for | technical interfaces | reading proficiency / legibility |
| Tabular figures | yes, native | relies on `font-variant-numeric` support (see risk) |
| Readability at a glance on bright screens | good | the reason it exists |
| Cost to adopt | already present | one `@fontsource` dependency + weight imports |

## Decision

**`--font-ui: "Lexend"`**, loaded via `@fontsource/lexend` (weights 400/500/600/700) imported in
[`main.tsx`](../../web/src/main.tsx). The previous IBM Plex Sans declaration is kept commented in
`tokens.css` with a dated note, not deleted, so the swap is legible to the next reader.

**`--font-code` is unchanged — still IBM Plex Mono.** Machine-readable identifiers (request ids,
action codes, policy versions) render through the `.code` class and must stay monospaced; nothing
about this decision touches them.

## Consequences

- **Figure alignment is retained via `font-variant-numeric: tabular-nums` on `body`**
  ([`global.css:30`](../../web/src/design/global.css)) — the request that keeps readings and
  timestamps from jittering as digits change stays in place across the font swap.
- **Open risk to verify:** tabular figures only render if the face exposes the OpenType `tnum`
  feature. IBM Plex Sans guaranteed this; Lexend must be checked. If Lexend does not ship
  tabular figures, numeric columns lose alignment despite the `tabular-nums` request being a
  no-op — at which point either the numeric readouts move to a tabular face (e.g. reuse
  `--font-code` for the big WBGT figure) or we accept proportional figures for prose numbers.
  **Action:** confirm on the live board once real readings render.
- **One new dependency.** `@fontsource/lexend` and four self-hosted weight imports. Self-hosting
  (rather than a Google Fonts `<link>`) keeps the app free of a third-party font request — same
  posture as the rest of the stack.
- **Reversible in one place.** Because everything reads `--font-ui`, reverting is a one-line
  token change plus removing the imports; no component references the font family directly.

## Alternatives

- **Keep IBM Plex Sans.** Rejected — readability on the target device was the driver, and native
  tabular figures do not outweigh it for a screen that is mostly labels and short fields.
- **System font stack.** Rejected — a safety console should render identically on every crew
  member's device; a system stack makes the interface look different per OS and browser.
- **Lexend without `tabular-nums`.** Rejected — drops the figure alignment a console of readings
  and timestamps needs; the `tabular-nums` request costs nothing to keep.

## Related

- [`tokens.css`](../../web/src/design/tokens.css) — where `--font-ui` and `--font-code` live and
  the two are documented as serving different jobs.
- [SCRUM-161 plan](../plans/SCRUM-161-create-shift-form-plan.md) — the restyle this decision was
  made under.
