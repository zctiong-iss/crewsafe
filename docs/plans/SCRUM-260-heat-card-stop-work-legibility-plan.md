# SCRUM-260 — The Heat conditions card stays legible during a lightning stop-work

During a lightning stop-work the Heat conditions card on *My shift* dims to 45% opacity and
labels itself *"Superseded by the lightning stop-work"*. The reading — the number a worker
uses to understand the heat they are standing in — becomes hard to read at exactly the moment
the screen matters most.

This removes the dim and rewrites the label. It does **not** remove the override: FR-12a
requires that a stop-work visibly override the heat plan, and that requirement is carried by
the words, not by the dim.

Part 2 of the original request — a live/simulated toggle on the lightning banner — is
**deferred and out of scope here**. There is no lightning data source in the system. See
[`lightning-data-source-brief.md`](lightning-data-source-brief.md) for what must exist first.

---

## What is on screen today

[`WbgtCard`](../../mobile/src/components/safety/WbgtCard.tsx) takes a `superseded` prop, set
by `MyShiftScreen` from `stopWorkActive`:

```tsx
opacity: superseded && !theme.highContrast ? 0.45 : 1,
```

and renders, in `danger` tone:

> Superseded by the lightning stop-work

## Scope: workers only, because only workers have this card

| Role | Tabs | Heat conditions card | Affected |
| --- | --- | --- | --- |
| WORKER | My shift · Alerts · Weather · Profile | `WbgtCard` on My shift | **yes** |
| SUPERVISOR | Shifts · Weather · Profile | — | no |
| SAFETY_MANAGER | Shifts · Weather · Profile | — | no |
| ADMIN | Shifts · Weather · Profile | — | no |

`RootNavigator` sends every non-WORKER role to `SupervisorTabs`, which has no *My shift*. The
Weather screen's hero card is a different component with no lightning context, and is never
dimmed — there is nothing to fix there.

**A heat card is deliberately not being added to the supervisor Weather screen.** A supervisor
reading conditions for a site they are not standing on should not be handed a personal shelter
instruction. That is the same argument `WeatherScreen`'s header already makes for keeping the
required heat actions off that screen.

Both auth routes are covered by construction: this is a rendering change in a shared
component, so `mock` and `cognito-password` get it identically. Nothing here branches on auth
mode.

## The dim goes

The card renders at full opacity in every state.

The existing code already contains the argument for this. `WbgtCard` skips the dim in high
contrast because *"at 45% opacity black-on-white falls to roughly 3.5:1 — under AA — so the
dim would defeat the exact mode a worker turned on to read the screen in sunlight."* The same
reasoning applies to a phone held at arm's length in Singapore daylight, which is the ordinary
case, not the accessible-mode case.

`HeatGuidance` makes the point independently: *"Dimming alone is ambiguous — a worker could
read a faded list as 'loading' or as a rendering quirk and follow it anyway."*

So the dim was never the mechanism. It was decoration on top of the mechanism, and it cost
legibility to provide it.

## The words change, and they still have to do FR-12a's job

**This label is load-bearing.** FR-12a: *"stop-work shall visibly override the heat plan until
cleared."* §7.1 is stronger — a lightning stop-work *suspends* the heat rest and hydration
plan. With `features.heatGuidanceCard` off, this label is the **only** place the app says so
in words. `mobile/README.md` records that explicitly and warns against removing it.

New text:

> **Shelter first — heat rules are paused until the lightning clears.**

Key: `wbgt.stopWorkOverride`. The old `wbgt.superseded` is **removed**, not left orphaned.

Why this wording and not the shorter *"Lightning Alert — seek shelter immediately"*:

- That sentence already exists, in larger type, in the banner immediately above. Repeating it
  spends the card's one line on something the worker has just read.
- It says nothing about the heat plan, so FR-12a would no longer be satisfied anywhere in the
  app while the guidance card is off.

The chosen line does both jobs in one sentence: *shelter first* is the instruction, *heat
rules are paused* is the override. It also avoids "superseded", a register mismatch on a
screen aimed at a wide range of literacy across seven languages.

Tone stays `danger`. It is not decoration — it is the only worded override.

## What does not change

- The banner above: same states, same colours, same copy.
- The card's fields, freshness badge, layout and font.
- `stopWorkActive` and its `validUntil` expiry check.
- High contrast: unchanged, because it never dimmed.

## Localisation

`wbgt.stopWorkOverride` in all seven locales — `en`, `zh-Hans`, `hi`, `ms`, `ta`, `bn`, `my` —
and `wbgt.superseded` deleted from all seven. `npm run check:locales` enforces parity and will
fail on a stale key, which is the intended guard.

The sentence is deliberately short and clause-free: it has to survive translation into scripts
whose line heights are already boosted (`ta`, `bn`, `my`) without wrapping to three lines on a
small phone.

## Risks

**Losing the override by accident.** The one real risk. Deleting the dim is safe; deleting or
weakening the *words* is not. A test must assert the label renders whenever `superseded` is
true, so a future refactor cannot quietly drop FR-12a.

**A full-strength card reading as "business as usual".** The card is now visually identical
during a stop-work and outside one, except for the line of danger-toned text. Mitigated by the
banner above it, which is a filled red block — but it is a real change in emphasis and should
be looked at on a device before merge, not only in a test.

**Wrapping.** A longer sentence than the old label, in seven languages, at 1.5x font scale.
Check `my` and `ta` at Extra large.

## Acceptance

- With a stop-work in force, the Heat conditions card renders at **full opacity** and its WBGT
  reading is as legible as it is with no stop-work.
- The card shows *"Shelter first — heat rules are paused until the lightning clears."* in
  `danger` tone whenever a stop-work is in force, and shows no override line otherwise.
- Advisory and Clear are unchanged from today.
- High contrast is unchanged.
- Verified as a **worker** in both `mock` and `cognito-password`, at default and Extra large
  text, in English and one non-Latin script.
- A test asserts the override text renders when `superseded` is true — the FR-12a guard.
- `npm run check:locales` passes with `wbgt.superseded` gone and `wbgt.stopWorkOverride`
  present in all seven locales.

---

## Out of scope

**Part 2 — the live/simulated lightning toggle.** Deferred until a lightning source exists.
`GET /api/v1/sites/{siteId}/lightning` is unimplemented, `weather_observation` has no lightning
column, and the NEA ingestion collects only air temperature, relative humidity, wind speed and
rainfall. A "live" lightning banner built on that would have to infer lightning from rainfall,
which is the one thing the request explicitly rules out. See
[`lightning-data-source-brief.md`](lightning-data-source-brief.md).

**Restoring `features.heatGuidanceCard`.** If that flag is ever turned back on, `HeatGuidance`
carries its own worded suspension and this label's role shrinks. That is a separate decision.
