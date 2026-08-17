# SCRUM-TBD — Mobile Card & Pill Redesign (implementation plan)

**Status:** Phases 1–3 complete — awaiting real Jira keys
**Branch:** `feat/scrum-tbd-mobile-card-pill-redesign`
**Canon:** [ADR-0017](../adr/0017-card-pill-design-language.md) · [Design language (Doc 1)](../design/crewsafe-card-pill-design-language.md)
**Backlog CSV:** `~/OneDrive/Desktop/crewsafe-mobile-card-pill-redesign-jira.csv`

> Placeholder keys `SCRUM-TBD-01…51` are find-and-replaceable once Jira assigns real keys on import.

---

## Why phased

The design doc's §8 is a single-screen refactor. "Redesign the mobile frontend" is 17 screens and 48 components. Doing both as one branch means a long-lived branch across the app's safety-critical surfaces. Instead:

| Phase | Delivers | Merge surface | Points |
|---|---|---|---|
| **1 — Foundation & plan screen** | The `Pill` component, progressive disclosure on `MitigationRow`, rationale clamp, press-to-fill danger, 7-locale strings, **automated guardrail gate** | 6 files | 32 |
| **2 — Pill migration** | The other 4 hand-rolled pills consolidated onto `Pill` | 4 isolated components | 17 |
| **3 — Card rollout** | `DisclosureCard` extracted; shift / safety / inbox / wellbeing cards converted | wide — sequenced last on purpose | 31 |

Each phase is independently mergeable and independently revertable. Phase 1 is the only one that blocks the others.

---

## Current state (verified against the working tree)

Everything the spec references exists — it is grounded, not aspirational:

- **Theme tokens all present** (`styles/colors.ts`): `danger` (`#C71A34` standard / `#B3001B` high-contrast), `surfaceAlt` (`#F6F6F6` → collapses to `#FFFFFF` in high contrast, which is exactly why entity chips must be bordered), `border` (`#CCCCCC` → `#000000`), `textInverse`, `borderStrong`, `onPrimary`.
- **Metrics are runtime-derived** (`buildTheme(highContrast, fontScale)`): `borderWidth` 1→2, `radius` 12→6, `minTouchTarget` 44→52.
- **`ExpandChevron` already exists** and already handles Reduce Motion by snapping to the destination angle. Reuse it; do not rebuild.
- **7 locales confirmed**: `en`, `zh-Hans`, `ms`, `hi`, `ta`, `bn`, `my`.

Gaps this programme closes:

- `components/common/` **does not exist** — Phase 1 creates it.
- **5 hand-rolled pills**: `RecommendationStatusPill` (142 lines), `PolicyStatusPill` (79), `ShiftStatusPill` (64), `FreshnessBadge` (57), plus the inline `originPill` in `MitigationRow`.
- **4 i18n keys missing in all 7 locales**: `showDetails`, `hideDetails`, `readMore`, `readLess`. (`originMandatory`, `originAdvisory`, `appliesToAll` already ship.)
- **Tests that will break**: `MitigationRow.test.tsx`, `RecommendationDetailScreen.test.tsx`, `EditPlanSheet.test.tsx`. `ShiftStatusPill` has **no test at all**.

---

## Two deliberate deviations from the spec

**1. `Pill` takes a closed tone union, not `tone?: string`.** (SCRUM-TBD-04)

The doc's code block types `tone` as a free-form string holding a theme colour. That lets any caller pass any colour, which quietly erodes D3 — *reserve colour for meaning* — and leaves it enforced by code review rather than by the compiler. A closed union (`'danger' | 'neutral' | 'info' | …`) resolved inside `Pill` means callers name a **meaning** and the type checker enforces the principle. The deviation is recorded back into the ADR so nobody reverts it to match the doc.

**2. The guardrail gate is automated, not eyeballed.** (SCRUM-TBD-22 — the highest-value addition here)

ADR-0017 §6 declares the gate a merge blocker, but §8.6 defines it as *"run the plan screen and eyeball"* — fontScale 1.5, high contrast, long rule codes, `+N` overflow, English **and** Tamil. A manual six-point checklist across a three-phase programme gets skipped by about phase 2, and it is the safety-critical properties that stop being checked.

Building it once as a jest render harness (`renderUnderGuardrails`, a `fontScale × highContrast × locale` matrix) makes Phases 2 and 3 verifiable for free, and turns "merge blocker" from an intention into CI.

---

---

## Phase 1 — what shipped (2026-08-17)

| Ticket | Delivered |
|---|---|
| TBD-02/03/04 | `mobile/src/components/common/Pill.tsx` — three roles, closed `PillTone` union |
| TBD-05 | `Pill.test.tsx` — 8 tests, incl. the high-contrast border and tone-ignored-on-entity cases |
| TBD-06 | ADR-0017 addendum recording both deviations |
| TBD-07…11 | `MitigationRow` two-tier refactor; `MitigationRow.test.tsx` 8 → 16 tests |
| TBD-12/13/14 | Rationale clamp + Read more on `RecommendationDetailScreen`; 6 → 10 tests |
| TBD-15/16/17 | `AppButton` press-to-fill `danger`; new `AppButton.test.tsx`, 9 tests |
| TBD-18/19/20 | 4 keys × 7 locales (28 strings) |
| TBD-22/23/24 | `src/testing/guardrails.tsx` + 80-case gate, wired into Mobile CI |

**Verification:** `tsc --noEmit` clean · `eslint` 0 errors (8 pre-existing warnings, none in new
files) · `npm test` 65 suites / 738 tests green · `npm run check:locales` all 7 in parity.

### TBD-21 was cancelled as a duplicate

The plan called for a new locale key-parity test. `mobile/scripts/check-locale-parity.mjs`
already existed and already ran in Mobile CI, and it is strictly more thorough than what was
specified — beyond missing/extra keys it validates `{{placeholder}}` parity and detects text
written in the wrong script for its file. A jest-side second checker was written, then deleted:
two parity checkers drift, and the weaker one wins arguments it should lose.

That existing script is also what verified the 28 new strings: all 7 locales pass, including the
wrong-script detection, so the Tamil/Bengali/Myanmar/Hindi additions are in the correct scripts.

### Translation caveat carried forward

`ms`, `ta`, `bn` and `my` carry a `_translationStatus` of **"MACHINE-DRAFTED, NOT
NATIVE-REVIEWED"**. The four strings added in Phase 1 are machine-drafted too and inherit that
caveat. They are UI chrome ("Details", "Read more") rather than safety instructions, so they are
not in the FR-26c critical set — but they still want a native pass before the programme closes.

---

## Phase 2 — what shipped (2026-08-17)

All four remaining hand-rolled pills now render through `Pill`. Each file kept only its
status → role/tone mapping; the shape, fill rule, border and text treatment moved to one place.

| Ticket | Delivered |
|---|---|
| TBD-26/27/28 | `RecommendationStatusPill` 142 → 93 lines. Status map is now **total** over the type, so a new backend status is a compile error rather than a silent green "Approved". 7 → 10 tests. |
| TBD-29/30 | `ShiftStatusPill` 64 → 37 lines; **first test coverage**, 6 tests. |
| TBD-31/32 | `PolicyStatusPill` 79 → 37 lines. |
| TBD-33/34 | `FreshnessBadge` 57 → 39 lines; 5 → 10 tests. |
| TBD-35/36 | Sweep + `Pill.guardrails.test.tsx`, 288 gate cases over the four migrated pills. |

**Verification:** `tsc` clean · eslint 0 errors · **67 suites / 1042 tests green** · guardrail
gate 368 cases · all 7 locales in parity.

### An AA bug was found in Phase 1's `Pill` and fixed here

`Pill` filled a `state` pill with the tone colour and put `textInverse` on it. For
`tone="warning"` that resolves to `#B26A00`, which `colors.ts` documents as **4.24:1 against
white — under the 4.5:1 AA floor**. `warningFill` exists for exactly this and the shipped
`RecommendationStatusPill` was already using it correctly, so migrating it onto `Pill` would
have *introduced* a contrast failure on the "Awaiting decision" pill.

`PillTone` now resolves to a `{ fill, ink }` pair rather than one colour, because "legible ON
white" and "legible UNDER white" are opposite problems. Two tests lock it in.

### The `numberOfLines={1}` clamp was removed — and this is the item wanting human eyes

`RecommendationStatusPill` and `PolicyStatusPill` both shipped with a one-line clamp,
documented against a real defect: a wrapping pill painted its second line *outside* its own
fill, so "Waiting on your decision" rendered as "Waiting on your" with the last word gone.

The clamp is gone, for two reasons. ADR-0017 §6 forbids clipping outright; and a pill reading
"Waiting on your…" contradicts the ADR's own rule that **text is the source of truth and colour
is only reinforcement** — a truncated label is a worse failure than a two-line one.

That is safe *only* because `Pill` carries the structural half of the original fix
(`flexDirection: "row"` + `maxWidth: "100%"` + `flexShrink`), which is what made the pill
measure against its whole string instead of its first break opportunity. The clamp was
belt-and-braces on top. `Pill.guardrails.test.tsx` asserts the structural half holds across
288 cases using the genuine longest Tamil and Burmese translations.

**But the test renderer has no layout engine.** It proves nothing clamps and nothing caps the
width; it cannot prove the second line paints inside the fill. **Before merging Phase 2, look
at a PENDING_APPROVAL pill in Tamil at fontScale 1.5.** This is the judgement half of the gate.

### A sixth pill was found — logged, not migrated

The TBD-35 sweep turned up an **acclimatisation chip** that the original catalogue of five
missed, duplicated across `ShiftCard.tsx` and `ShiftDetailScreen.tsx` and already drifted
between the two (different padding, `label` vs `caption` text). Both are outlined + warning and
map cleanly onto `Pill`.

It was **not** migrated in the sweep: the `ShiftDetailScreen` copy carries an explicit
"centred because it is the only element on its own line" comment, and `Pill` is
`alignSelf: flex-start`. Converting it would silently override a documented layout decision.
Raised as **SCRUM-TBD-52/53/54** so the centring gets a deliberate call.

Consequently TBD-35's acceptance criterion "grep finds no remaining hand-rolled pill" is **not
yet met** — it is met for the five catalogued pills and blocked on TBD-52 for the sixth.

---

## Phase 3 — what shipped (2026-08-17)

| Ticket | Outcome |
|---|---|
| TBD-38/39/40 | **`Disclosure` extracted**, 9 tests. `MitigationRow` refactored onto it — 113 tests pass with **no assertion changes**. |
| TBD-41/42 | `ShiftListScreen` crew toggle rewired onto `Disclosure` (controlled). **First-ever test coverage**, 6 tests. |
| TBD-43 | **Conversion declined.** Safety surfaces gated instead — 112 cases. |
| TBD-46 | **Conversion declined.** Gate coverage deferred to TBD-57. |
| TBD-49/50/51 | Open items closed out; **D1 found to be wrong about mobile** (TBD-55). |

**Verification:** `tsc` clean · eslint 0 errors · **70 suites / 1169 tests green** · guardrail
gate **480 cases** · all 7 locales in parity.

### It is `Disclosure`, not `DisclosureCard`

§7 names the contract `DisclosureCard`. The `summary`/`detail` split is right and is kept; the
*card* is not. Both call sites are already inside a card — `MitigationRow` is a row within one,
`ShiftListScreen`'s toggle sits in a list cell that is one — so a second card surface would have
meant a nested border in high contrast. What is genuinely shared is the disclosure contract:
the toggle, its accessible name, and the rule that detail does not mount while closed.

It also needed a **controlled** mode that §7 does not specify. `ShiftListScreen`'s rows live in a
`FlatList`, which unmounts them on scroll — self-held state would forget which crews were open
the moment a supervisor scrolled past and back.

### Two conversions were declined, and this is the main finding of Phase 3

The plan assumed the safety, inbox and wellbeing cards wanted progressive disclosure. Reading
them, they do not — and the arguments against are already written into the components:

- **`LightningBanner`** — "a banner that quietly vanished would be read as permission by a worker
  who simply looked away for a minute". A collapsible stop-work warning *is* that failure with a
  control attached.
- **`WbgtCard`** — its `stopWorkOverride` line is, with `features.heatGuidanceCard` off, the only
  place the app states FR-12a in words. SCRUM-260 already removed a 45% dim from this card because
  a dimmed card reads as "loading" as readily as "superseded"; an expand is a stronger version of
  that same bug.
- **`HeatGuidance`** — §7.1 requires the suspension to be *visible*, not discoverable, and the
  actions stay beside it so a worker sees what resumes.
- **`CrewWellbeingRow`** — "the absent row is the important one". Its whole purpose is showing the
  worker who has logged *nothing*.
- **`WellbeingLogCard`** — "two buttons and nothing else", by explicit design.

TBD-43's own acceptance criteria said no safety-critical text may move behind a disclosure.
Applied honestly, there is nothing left on these that may move. **ADR-0017 §3 scopes progressive
disclosure to plan judgement** — "the evidence hides behind an expand, revealed only when a
supervisor judges the plan" — not to every card in the app.

What the tickets bought instead is proof the surfaces survive the gate: 112 cases across large
text, high contrast and the three tall-line-box scripts, which nothing previously checked. Three
of those cases are regression guards asserting the safety text is **not** behind a control, so a
future well-meant tidy-up fails CI.

### D1 does not describe the shipped app

ADR-0017 records D1 as locked: *"Lexend everywhere (web + mobile Latin)"*. Web ships Lexend.
**Mobile ships Gelasio and contains zero references to Lexend.** ADR-0012, which D1 cites, is
web-only by its own text.

Left unresolved on purpose — a typeface is the design team's call. Raised as **TBD-55/56**. Note
that "restoring" D1 would touch every screen and invalidate the `LINE_HEIGHT_RATIO` of 1.35 that
`fonts.ts` tunes specifically to Gelasio's ascenders.

---

## Risk notes

- **Phase 3 / safety surfaces (SCRUM-TBD-43) is the one to watch.** `WbgtCard`, `HeatGuidance` and `LightningBanner` are the glare-and-hazard screens the entire CVD argument exists to protect. Progressive disclosure must **never** put a stop-work instruction behind an expand — the summary tier has to carry the actionable message. SCRUM-260 already fixed a heat-card legibility bug here, and SCRUM-440's auto-dispatched stop-work has to survive the conversion.
- **`DispatchCard`** combines `SwipeToDismiss` with a rest timer; a disclosure toggle inside a swipeable row can steal the gesture.
- **`RecommendationStatusPill`** is the component `Pill`'s shape was lifted *from*, so migrating it is the truest test of the abstraction — and it must keep rendering `SUPERSEDED` (SCRUM-291).

---

## Out of scope

ADR-0017's open items 1, 2 and 4 (web `--danger` token, the `border-colorvar` typo at `WorkIntensitySegmented.css:45`, web i18n) are web-side. Confirm they are tracked separately rather than silently dropped — that is SCRUM-TBD-49.
