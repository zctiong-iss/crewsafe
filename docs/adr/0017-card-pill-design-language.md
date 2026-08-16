# ADR 0017 — Card & Pill Design Language

**Status:** Accepted  
**Date:** 2026-08-15  
**Jira:** —

---

## Context

CrewSafe ships two front-ends (React web and React Native mobile) that drifted visually over time: five hand-rolled pill components on mobile, a separate `.pill` grammar on web, no shared vocabulary for cards, status chips, or destructive actions. A supervisor with red-green colour blindness must parse a heat-safety plan under glare. The design team (Chee Seng + Justin Chua) settled a unified card/pill language across two companion specs and needs the decision recorded as canon to prevent future relitigations.

## Decision

Adopt as canon:

1. **Three-role pill/chip taxonomy, one shape:**
   - **STATE** = FILLED (reserved for a status actively asking for a decision *now*, e.g. "Awaiting decision")
   - **ATTRIBUTE** = OUTLINED (classifies the item — Required/Suggested, work intensity)
   - **ENTITY** = NEUTRAL fill, ALWAYS bordered (names an identity such as a worker; never carries semantic colour)

2. **Progressive-disclosure cards:** A summary tier is always visible and scannable; a detail tier expands on demand.

3. **Press-to-fill destructive actions:** High-impact actions (Cancel Shift, Reject plan) are outlined at rest and fill with the danger colour on engage (hover on web, press on mobile) — making commitment a deliberate, visible act.

4. **Every colour is paired with a text label** (CVD safety) — colour is reinforcement, never the only cue.

This decision also records three previously-locked decisions as foundational to this design language:
- **D1:** Lexend everywhere (web + mobile Latin; mobile keeps per-script Noto for Tamil/Bengali/Myanmar)
- **D2:** Theming models stay intentionally DIFFERENT per platform (web = single fixed theme; mobile = runtime `highContrast` + `fontScale`)
- **D3:** Reserve colour for meaning (chrome is neutral; a saturated colour is a signal, never decoration)

## Rationale

**Why reserve colour for meaning:** A colour-blind supervisor can still parse the screen because the loud filled pill is spent on the ONE thing needing a decision, so it doesn't compete with a filled pill on every mandatory action. Most mitigations are mandatory, so an outlined **attribute** pill (not filled) for Required keeps the **state** fill as the decision signal. Colour is reinforcement; text is the source of truth.

**Why one shape across three roles:** A consistent visual grammar (padding, radius, text treatment) is learnable. Entity chips must always have a border because in high-contrast mode, a neutral fill collapses to match the surface — the border carries the chip's edge when fill alone cannot.

**Why progressive disclosure:** Showing everything at once shows nothing. The summary tier drives a decision; the evidence hides behind an expand, revealed only when a supervisor judges the plan.

## Consequences

**Positive:**
- Shared vocabulary across web and mobile, and a testable guardrail gate (large text, high contrast, long content wraps, `+N` overflow, seven languages, responsive <768px, no horizontal body scroll) becomes a merge blocker.
- Both platforms and their LLMs can target one design language rather than negotiating two.

**Open items (carried forward, not resolved by this ADR):**
1. **Web `--danger` token.** Both the Reject button and Required pill borrow `--band-high` (WBGT High-Risk red) as a provisional stand-in while `tokens.css` is under CVD review. Reconcile onto a real `--danger` token when that review lands.
2. **`border-colorvar` typo** at `web/src/features/shifts/WorkIntensitySegmented.css:45` — pre-existing bug, unrelated to this decision, carried forward for a separate fix.
3. **ADR-0012's Lexend tabular-figures claim** is unverified — noted in D1, not re-checked as part of this decision.
4. **Web has no i18n today.** Doc 2 proposes standing up i18next to reach mobile's 7-locale parity for the plans feature; this is orthogonal to D1–D3 theming but necessary for feature parity.

## Alternatives rejected

1. **Put Required/Suggested under the FILLED state role:** Rejected — most actions are mandatory, so filling every one drowns the one status actually asking for a decision. Outlined **attribute** pills reserve fill for the **state** pill.

2. **Port one platform's theming model onto the other (unify web+mobile theming now):** Rejected — D2 keeps them different on purpose (web = fixed CSS custom properties; mobile = runtime `highContrast`/`fontScale`). A shared neutral token substrate is desired LATER, gated on both platforms shipping clean under the guardrail gate.

3. **Rely on colour alone for pill meaning:** Rejected on CVD-safety grounds. Colour is reinforcement; text is the source of truth. Every pill carries its label.

## Related

- `crewsafe-card-pill-design-language.md` (Doc 1 — the foundational language + mobile refactor)
- `crewsafe-web-plan-card-spec.md` (Doc 2 — the web build, with web i18n infrastructure)
- `unified-design-system-decision.md` (originating doc for D1–D3)
- ADR-0012 (Lexend, referenced in D1)
- ADR-0013 (Timezone, in the same ADR sequence; this is 0017)
