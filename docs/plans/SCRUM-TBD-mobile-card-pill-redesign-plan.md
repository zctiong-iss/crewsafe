# SCRUM-TBD — Mobile Card & Pill Redesign (implementation plan)

**Status:** Phase 1 complete — awaiting real Jira keys
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

## Risk notes

- **Phase 3 / safety surfaces (SCRUM-TBD-43) is the one to watch.** `WbgtCard`, `HeatGuidance` and `LightningBanner` are the glare-and-hazard screens the entire CVD argument exists to protect. Progressive disclosure must **never** put a stop-work instruction behind an expand — the summary tier has to carry the actionable message. SCRUM-260 already fixed a heat-card legibility bug here, and SCRUM-440's auto-dispatched stop-work has to survive the conversion.
- **`DispatchCard`** combines `SwipeToDismiss` with a rest timer; a disclosure toggle inside a swipeable row can steal the gesture.
- **`RecommendationStatusPill`** is the component `Pill`'s shape was lifted *from*, so migrating it is the truest test of the abstraction — and it must keep rendering `SUPERSEDED` (SCRUM-291).

---

## Out of scope

ADR-0017's open items 1, 2 and 4 (web `--danger` token, the `border-colorvar` typo at `WorkIntensitySegmented.css:45`, web i18n) are web-side. Confirm they are tracked separately rather than silently dropped — that is SCRUM-TBD-49.
