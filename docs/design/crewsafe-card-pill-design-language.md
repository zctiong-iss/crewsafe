# CrewSafe — Card & Pill Design Language (Foundational)

**Status:** Draft for Justin's review → then push to repo (see §9)
**Audience:** Justin (mobile) + Chee Seng (web), and the LLMs either of us points at CrewSafe UI work
**Scope:** The shared visual + interaction language for cards, pills/chips, progressive disclosure, and destructive actions — plus a concrete, paste-ready mobile refactor of the AI-drafted plan screen.

> **How to use this doc.** Read §0 (baton) → §1–§6 (the language) → §8 (apply the mobile code). It is deliberately *not* written as a teaching walkthrough — the code blocks are ready to apply. Everything here is grounded in code that already ships; where it changes behaviour that is called out.

---

## 0. Memory baton — paste into your LLM's context first

```
CrewSafe design-system baton (2026-08-15)

LOCKED DECISIONS (do not relitigate):
- D1 Typeface: Lexend everywhere (web + mobile Latin). Per-script Noto fallback stays for
  Tamil/Bengali/Myanmar (mobile).
- D2 Theming model: intentionally DIFFERENT per platform. Web = single fixed theme.
  Mobile = runtime highContrast toggle + fontScale 0.85–1.5 (buildTheme in styles/theme.ts).
- D3 Colour identity: mobile monochrome chrome + semantic colour; web navy/warm-stone chrome.
  => Principle both share: RESERVE COLOUR FOR MEANING. Chrome is neutral; a saturated colour
     is a signal (hazard/status), never decoration.
- Follow-on (token substrate): one neutral source is desired LATER, gated on nothing breaking,
  overflowing, or crashing on either platform. Not now.

CARD/PILL LANGUAGE (this doc):
- Progressive disclosure: a card shows a SUMMARY tier always; DETAIL tier expands on demand.
- Pill/chip taxonomy — one shape, three roles:
  * STATE pill  = FILLED. Reserved for a status actively asking for a decision (e.g. Awaiting
    decision). Fill is loud on purpose; use it for the one actionable thing.
  * ATTRIBUTE pill = OUTLINED. Classifies the item (Required/Suggested, work intensity).
  * ENTITY chip = NEUTRAL fill, always bordered. Names an identity (worker). NO semantic colour.
- Destructive actions (Cancel Shift, Reject): press-to-fill. Outlined at rest, fill with the
  danger colour on engage (hover=web, pressed=mobile). Colour role = `danger`.
- Every colour is paired with a text label beside it (CVD safety).

GUARDRAIL GATE (must hold before merge): fontScale 1.5 no clip; high-contrast legible;
long rule codes wrap; long worker lists overflow to "+N"; all pill/chip text via AppText
(multi-script line-height); web responsive <768px, no horizontal body scroll.

DOC LOCATION STANDARD:
- Design language + platform specs  -> docs/design/
- Architecture decision records      -> docs/adr/   (next free number)
- Implementation plans               -> docs/plans/
```

---

## 1. The locked decisions (baseline)

These are settled (from `unified-design-system-decision.md`, signed off by both of us). This document builds on them, it does not reopen them.

| # | Decision | Consequence for this doc |
|---|---|---|
| D1 | **Lexend** everywhere (Latin) | all UI text is Lexend; mobile keeps per-script Noto for Tamil/Bengali/Myanmar |
| D2 | Theming models stay **different** (web fixed / mobile runtime) | components read the platform's own theme source — do not port one model onto the other |
| D3 | Mobile **monochrome** / web **chromatic** chrome | **reserve colour for meaning** — the shared rule that makes the pill taxonomy work |
| — | Neutral token source **later**, gated on nothing breaking | do not extract tokens yet; keep using each platform's current source |

---

## 2. Principles

1. **Reserve colour for meaning.** The chrome is quiet (mono on mobile, navy/stone on web). A saturated colour therefore *always* reads as a signal — a hazard band, a status, a required action. This is what lets a red-green colour-blind supervisor still parse the screen: colour is never the *only* cue, and it is never spent on decoration.
2. **The label sits beside the colour.** Every pill, chip and band carries its word. "Heavy", "Required", "Awaiting decision" — the text is the source of truth; the colour is reinforcement.
3. **Progressive disclosure.** Show the one line that drives a decision; hide the evidence behind an expand. A screen that shows everything at once shows nothing.
4. **Guardrails before polish.** The §6 gate (large text, high contrast, long content, seven languages) is a merge blocker, not a nice-to-have. This is the D-follow-on condition made concrete.

---

## 3. Progressive-disclosure card anatomy

Applied to one proposed action (mobile calls it a **mitigation**). Today `MitigationRow` renders every field always-on — that is the "big chunk" in the screenshots. Split it:

```
┌────────────────────────────────────────────── card ──┐
│ SUMMARY (always visible, scannable)                    │
│   Rest 15 minutes without a break        [Required]    │  ← title + attribute pill
│   15 min · every hour                                  │  ← timing sub-line
│   [ Meng Hui ] [ Siti ] [ +2 ]                         │  ← applies-to as ENTITY chips
│   Details  ⌄                                           │  ← disclosure toggle
│ ─ DETAIL (revealed on expand) ───────────────────────  │
│   Reason         Worker is on day 2 of acclimatisation…│
│   Rule           UNACCLIMATISED_HEAVY_WORK_RULE        │
│   Expected effect Reduces heat strain by ~15–20%…      │
└────────────────────────────────────────────────────────┘
```

- **Summary tier (always):** title (`actionCode`→i18n, `action` fallback) · **Required/Suggested** attribute pill · timing phrase · **applies-to as entity chips** (or one "All crew" chip) · disclosure control.
- **Detail tier (on expand):** Reason (`rationale`) · Rule (`ruleReference`) · Expected effect (`estimatedImpact`).
- **Recommendation-level narrative** ("Why this was drafted"): clamp to ~3 lines + "Read more" — this is the single biggest text block on the screen.

The category grouping (Rest / Hydration headings) stays exactly as it is.

---

## 4. Pill/chip taxonomy — one shape, three roles

One component, three roles. The shape (padding, `radius/2`, `alignSelf: flex-start`, caption text) is lifted straight from the shipped `RecommendationStatusPill`.

| Role | Rendering | Meaning | CrewSafe source |
|---|---|---|---|
| **State** | **FILLED** (fill + inverse text) | a status actively asking for a decision *now* | `Recommendation.status === PENDING_APPROVAL` → "Awaiting decision" |
| **Attribute** | **OUTLINED** (border + text, transparent fill) | a classification of the item | `Mitigation.origin` (Required/Suggested); work intensity |
| **Entity** | **NEUTRAL** (`surfaceAlt` fill, **always bordered**, no semantic colour) | an identity/tag | `Mitigation.appliesTo` → worker `displayName` |

> **Refinement vs the plan (deliberate).** The plan's first draft put `origin` (Required/Suggested) under the *filled* state role. The shipped code already renders Required as an **outlined** red pill and reserves fill for the *pending status* pill — and that is the better call: most actions are mandatory, so a filled pill on every one would shout over the one thing that actually needs a decision. So origin is an **attribute** (outlined) pill here. This formalizes existing behaviour rather than changing it.

**Why entity chips are always bordered:** in mobile high-contrast, `surfaceAlt` collapses to `surface` (both white) — a fill-only chip would vanish. The border is what carries the chip's edge under glare. In standard mode the border is a faint `#CCC`; in high-contrast it is `#000`, so the chip reads as outlined exactly when it needs to.

---

## 5. Destructive-action affordance — press-to-fill

High-impact actions (**Cancel Shift**, **Reject plan**) are **outlined at rest and fill with `danger` the moment you engage** — hover on web, pressed on mobile. Committing becomes a visible, deliberate act instead of a same-weight tap.

**Origin (shipped, web):** `web/src/features/shifts/CreateShiftForm.css:147-159`, `.shift-form__danger` — rest is `background: --surface` + `--band-high` text/border; `:hover:not(:disabled)` flips to `background: --band-high` + `--action-ink`.

- **Colour role = `danger`.** Web currently *borrows* `--band-high` (WBGT High-Risk red) with the note "no new token while tokens.css is under CVD review." The correct long-term role is a `danger` semantic distinct from the hazard scale. Mobile already has `theme.colors.danger` — use it directly. **Open item:** reconcile web's `--band-high` borrow into a real `--danger` token when the CVD review lands.
- **Reduced motion:** the swap is an instant colour change (no animated transition on mobile; web's transition is zeroed under `prefers-reduced-motion`). Safe by construction.

---

## 6. Guardrails — the gate (merge blocker)

Every change in §8 must survive all of these. This is the D-follow-on condition ("nothing breaks, overflows, or crashes") made testable.

- [ ] **Large text:** mobile `fontScale = 1.5` — no clipped pill, chip, or label. (The origin pill's old `maxWidth: s(110)` is dropped; pills size to content and wrap.)
- [ ] **High contrast ON:** entity chips visibly bordered; no fill-only cue relied upon.
- [ ] **Long rule code:** `UNACCLIMATISED_HEAVY_WORK_RULE` wraps, never overflows its row.
- [ ] **Long worker list:** chips wrap, then overflow to `+N`.
- [ ] **Seven languages:** all pill/chip text goes through `AppText` (so Tamil/Bengali/Myanmar line-height boosts apply); render the screen in Tamil to confirm.
- [ ] **Web parity (doc #2):** responsive stack < 768px; no horizontal body scroll.

---

## 7. Component contract + reuse map

Platform-neutral shape; each platform implements in its own idiom and its own theme source (D2).

- `Pill { role: "state" | "attribute" | "entity"; label; tone? }` — `tone` drives fill (state) or outline+text (attribute); ignored for entity.
- `DisclosureCard { summary; detail; defaultOpen? }` — summary always rendered; detail mounts on expand.

| | Mobile reuses | Web reuses |
|---|---|---|
| Card surface | `cardSurface()` (`styles/sharedStyles.ts`) | global `.card` |
| Disclosure | `ExpandChevron` + `useState` | `ShiftCard` `aria-expanded` button pattern |
| Text | `AppText` (variants/tones, per-language font) | `.eyebrow` + tokens |
| Theme | `useTheme()` / `theme.metrics` | CSS custom properties |
| Pills | **new** `components/common/Pill.tsx` (this doc) | **new** shared `.pill` (doc #2, lifted from `ShiftList.css`) |

---

## 8. Mobile implementation — apply these

### 8.1 New — `mobile/src/components/common/Pill.tsx`

Consolidates the five hand-rolled pills (`RecommendationStatusPill`, `ShiftStatusPill`, `FreshnessBadge`, `PolicyStatusPill`, the inline origin pill) into one.

```tsx
/**
 * The app's one pill/chip — three roles, one shape, so status, classification and identity
 * read as a single visual language.
 *
 * FILL (state) is reserved for a status actively asking for a decision; OUTLINE (attribute)
 * classifies; a NEUTRAL entity chip names an identity and never carries semantic colour —
 * colour is kept for meaning (D3). Shape lifted from the former RecommendationStatusPill.
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

export type PillRole = "state" | "attribute" | "entity";

interface PillProps {
  role: PillRole;
  label: string;
  /** A theme colour: fills a state pill, outlines+colours an attribute pill. Ignored for entity. */
  tone?: string;
}

const Pill: FC<PillProps> = ({ role, label, tone }) => {
  const theme = useTheme();
  const accent = tone ?? theme.colors.textSecondary;

  const surface =
    role === "state"
      ? { backgroundColor: accent, borderColor: accent }
      : role === "attribute"
        ? { backgroundColor: "transparent", borderColor: accent }
        : // entity: neutral fill, always bordered (surfaceAlt collapses to surface in high contrast)
          { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border };

  const textColor =
    role === "state"
      ? theme.colors.textInverse
      : role === "attribute"
        ? accent
        : theme.colors.textPrimary;

  return (
    <View
      style={[
        styles.pill,
        surface,
        { borderWidth: theme.metrics.borderWidth, borderRadius: theme.metrics.radius / 2 },
      ]}
    >
      <AppText variant="caption" numberOfLines={1} style={[styles.label, { color: textColor }]}>
        {label}
      </AppText>
    </View>
  );
};

export default Pill;

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(8),
    paddingVertical: vs(2),
    alignSelf: "flex-start",
    // A row (not a bare box) so the pill sizes to the whole label, not its first break opportunity.
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
  },
  label: { flexShrink: 1 },
});
```

> Migrating the four other pills onto `Pill` is a follow-up (map pending→`state`, others→`attribute`, freshness→`attribute`). Not required to ship the plan-screen refactor.

### 8.2 Refactor — `mobile/src/components/recommendations/MitigationRow.tsx`

Two changes: (a) `appliesTo` moves into the summary as **entity chips** with `+N` overflow; (b) Reason / Rule / Expected effect move into a **collapsible detail tier** behind an `ExpandChevron`. Keep the `label`, `origin` and `timingPhrase` logic you already have — only the render below changes.

Add imports:

```tsx
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import ExpandChevron from "@/components/feedback/ExpandChevron";
import Pill from "@/components/common/Pill";
```

Replace the `origin` pill (the inline `<View style={styles.originPill}>…`) with an attribute `Pill`:

```tsx
{mitigation.origin ? (
  <Pill
    role="attribute"
    tone={mitigation.origin === "MANDATORY" ? theme.colors.danger : theme.colors.textSecondary}
    label={
      mitigation.origin === "MANDATORY"
        ? t("recommendations.originMandatory")
        : t("recommendations.originAdvisory")
    }
  />
) : null}
```

Replace the whole `showDetail && !removed` block with a summary (applies-to chips) + a collapsible detail:

```tsx
{showDetail && !removed ? (
  <MitigationDetail mitigation={mitigation} workerNameFor={workerNameFor} />
) : null}
```

…and add this local component in the same file (keeps the row's own state out of the parent list):

```tsx
const MAX_WORKER_CHIPS = 4;

const MitigationDetail: FC<{
  mitigation: Mitigation;
  workerNameFor?: (workerId: string) => string;
}> = ({ mitigation, workerNameFor }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const appliesToAll = mitigation.appliesTo === null || mitigation.appliesTo.length === 0;
  const names = appliesToAll
    ? []
    : mitigation.appliesTo!.map((id) => workerNameFor?.(id) ?? id);
  const shown = names.slice(0, MAX_WORKER_CHIPS);
  const overflow = names.length - shown.length;

  return (
    <>
      {/* Applies-to as chips — the "these two people vs the whole crew" distinction, always visible. */}
      <View style={styles.chips}>
        {appliesToAll ? (
          <Pill role="entity" label={t("recommendations.appliesToAll")} />
        ) : (
          <>
            {shown.map((name, i) => (
              <Pill key={`${name}-${i}`} role="entity" label={name} />
            ))}
            {overflow > 0 ? <Pill role="entity" label={`+${overflow}`} /> : null}
          </>
        )}
      </View>

      {/* Disclosure — the evidence a supervisor reads only when judging a plan. */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? t("recommendations.hideDetails") : t("recommendations.showDetails")}
        hitSlop={8}
        style={styles.disclosure}
      >
        <AppText variant="caption" tone="secondary">
          {open ? t("recommendations.hideDetails") : t("recommendations.showDetails")}
        </AppText>
        <ExpandChevron expanded={open} size={s(16)} color={theme.colors.textSecondary} />
      </Pressable>

      {open ? (
        <View>
          {mitigation.rationale ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">{t("recommendations.rationale")}</AppText>
              <AppText variant="caption">{mitigation.rationale}</AppText>
            </View>
          ) : null}
          {mitigation.ruleReference ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">{t("recommendations.ruleReference")}</AppText>
              {/* Long codes wrap rather than overflow the row. */}
              <AppText variant="caption">{mitigation.ruleReference}</AppText>
            </View>
          ) : null}
          {mitigation.estimatedImpact ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">{t("recommendations.estimatedImpact")}</AppText>
              <AppText variant="caption">{mitigation.estimatedImpact}</AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
};
```

Add to the `StyleSheet` (keep the existing entries; drop `originPill`, now unused):

```tsx
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: s(6),          // RN ≥ 0.71 / Expo SDK ≥ 49; if older, use marginEnd/marginTop on Pill
    marginTop: vs(6),
  },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
    marginTop: vs(6),
    minHeight: 44,      // keeps the toggle a full touch target regardless of text size
  },
```

### 8.3 Screen wiring — `RecommendationDetailScreen.tsx` (rationale clamp)

Kill the biggest text chunk: clamp "Why this was drafted" and add a toggle. Add a `useState` at the top of the screen component, then replace the single rationale `<AppText>` with:

```tsx
// near the top of the component:
const [showFullWhy, setShowFullWhy] = useState(false);

// replacing the body rationale line under the "whyTitle" heading:
{recommendation.rationale ? (
  <>
    <AppText variant="body" numberOfLines={showFullWhy ? undefined : 3} style={styles.block}>
      {recommendation.rationale}
    </AppText>
    <Pressable
      onPress={() => setShowFullWhy((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded: showFullWhy }}
      hitSlop={8}
    >
      <AppText variant="caption" tone="secondary">
        {showFullWhy ? t("recommendations.readLess") : t("recommendations.readMore")}
      </AppText>
    </Pressable>
  </>
) : null}
```

### 8.4 Press-to-fill — `mobile/src/components/buttons/AppButton.tsx` (`danger` variant)

Make `danger` outlined at rest, filling on press. Primary/secondary keep their steady fill.

Add pressed state and swap the `danger` palette entry:

```tsx
import { useState } from "react";
// ...
const [pressed, setPressed] = useState(false);

const palette: Record<AppButtonVariant, { background: string; border: string; text: string }> = {
  primary: {
    background: theme.colors.primary,
    border: theme.colors.primary,
    text: theme.colors.onPrimary,
  },
  secondary: {
    background: theme.colors.surface,
    border: theme.colors.borderStrong,
    text: theme.colors.textPrimary,
  },
  // Destructive: outlined at rest, fills on press — committing is deliberate and visible,
  // mirroring the web Cancel Shift button. Instant swap, so reduce-motion-safe by construction.
  danger: pressed
    ? { background: theme.colors.danger, border: theme.colors.danger, text: theme.colors.textInverse }
    : { background: theme.colors.surface, border: theme.colors.danger, text: theme.colors.danger },
};
```

Add the press handlers to the existing `TouchableOpacity` (alongside `onPress`):

```tsx
onPressIn={() => setPressed(true)}
onPressOut={() => setPressed(false)}
```

(`isInactive` still overrides to the disabled palette, so a disabled danger button never fills.)

### 8.5 New i18n keys (all seven locales)

These strings are referenced above and do not exist yet — add them so no locale falls back to a key:

```
recommendations.showDetails   → "Details"
recommendations.hideDetails   → "Hide details"
recommendations.readMore      → "Read more"
recommendations.readLess      → "Read less"
```

Already present and reused: `originMandatory`, `originAdvisory`, `appliesToAll`, `rationale`, `ruleReference`, `estimatedImpact`.

### 8.6 Verify (the gate, §6)

```
cd mobile
npx tsc --noEmit
npm test         # RecommendationDetailScreen.test.tsx + any MitigationRow test stay green
```
Then run the plan screen and eyeball: `fontScale` 1.5, high-contrast ON, a mitigation applied to 5+ workers with a long rule code, in **English and Tamil** — no clip, no overflow, no crash. Press-and-hold the Reject button: it fills red.

---

## 9. Where this document lives in the repo

Once you've read it, push it (and the set that follows) using this convention — so both our models always know where to look:

| Document kind | Repo path | Example |
|---|---|---|
| **Design language / platform spec** (this doc, web spec) | `docs/design/` | `docs/design/crewsafe-card-pill-design-language.md` |
| **ADR** (the eventual decision record) | `docs/adr/` (next free number) | `docs/adr/0017-card-pill-design-language.md` |
| **Implementation plan** | `docs/plans/` | matches existing `SCRUM-###-*-plan.md` files |

**Recommendation for this file:** `docs/design/crewsafe-card-pill-design-language.md`. `docs/design/` does not exist yet — creating it establishes the home for the design-system set (this doc, the web spec, the reference artifact notes). ADRs stay in the existing `docs/adr/` sequence; the last one is 0016, so the design-language ADR would be **0017**.

---

## 10. Document roadmap

1. **This doc** — card/pill language + mobile refactor. *(Justin starts here.)*
2. **Web plan-card spec** — build the greenfield web plan view from `.card` / a lifted shared `.pill` / the `ShiftCard` disclosure pattern; introduce a web `Recommendation` type mirroring `mobile/src/types/domain.ts`.
3. **ADR 0017** — record the language + the three locked decisions as project canon.
4. **Reference artifact** — a visual specimen (pill roles, chip overflow, card states, press-to-fill) both platforms accept against.
5. **Token substrate** — the gated neutral source, only once 1–4 ship without breaking the §6 gate.
