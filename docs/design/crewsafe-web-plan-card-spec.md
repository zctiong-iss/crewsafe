# CrewSafe — Web Plan-Card Spec

**Status:** Draft for Justin's review → then push to repo (see §11)
**Audience:** Justin (mobile) + Chee Seng (web), and the LLMs either of us points at CrewSafe UI work
**Scope:** The greenfield web build for the AI-drafted recommendation plan view — a new `web/src/features/plans/` feature, expressed in web's existing idiom (`.card`, a lifted shared `.pill`, the `ShiftCard` disclosure pattern), plus a new `web/src/api/recommendations.ts` mirroring `mobile/src/types/domain.ts`, and the i18n infrastructure web needs to reach mobile's 7-locale parity for this feature.

This is **doc #2** of the design-system set. It builds on, and does not relitigate, [`crewsafe-card-pill-design-language.md`](./crewsafe-card-pill-design-language.md) (**doc #1** — the card/pill language + the mobile refactor). Read doc #1 first if you have not; this doc assumes its taxonomy (state/attribute/entity pills, progressive disclosure, press-to-fill) and only translates it into web's stack.

---

## 0. How to read this doc + memory baton

Read §0 (baton) → §1 (locked decisions) → §2–§7 (the web build, in build order: anatomy → pill CSS → disclosure → danger button → types/data layer → i18n) → §8–§10 (reuse map, gate, open items). Like doc #1, this is **not** a teaching walkthrough — code blocks are paste-ready. Everything is grounded in code that already ships in `web/`; anything new is labelled **NEW**.

```
CrewSafe web plan-card spec baton (2026-08-15) — doc #2 of the design-system set

READ FIRST: crewsafe-card-pill-design-language.md (doc #1) — this doc assumes its taxonomy.

LOCKED DECISIONS (do not relitigate):
- D1 Typeface: Lexend everywhere, via web's --font-ui.
- D2 Theming model: DIFFERENT per platform on purpose. Web = single fixed theme (CSS custom
  properties in tokens.css). Mobile = runtime highContrast/fontScale. This doc's i18n proposal
  does NOT touch D2 — i18n is orthogonal to theming, it is a string-resolution layer, not a
  colour/contrast system.
- D3 Colour identity: reserve colour for meaning. Web chrome is navy/warm-stone; a saturated
  colour is always a signal.
- i18n divergence (NEW, this doc): mobile has i18next + 7 locales already; web has ZERO i18n
  today (hardcoded English JSX). This doc proposes standing up web i18n to reach parity for the
  plans feature specifically — see §7.

WHAT THIS DOC BUILDS (all NEW unless noted):
- web/src/features/plans/  — PlansPage.tsx (route), PlanCard.tsx, MitigationRow.tsx,
  PlanActions.tsx + co-located .css (flat feature folder, matches web/src/features/shifts/).
- web/src/design/pill.css  — NEW shared .pill, three-role grammar, lifted out of
  ShiftList.css's `.pill` base rule so both shifts and plans use one definition.
- web/src/api/recommendations.ts — NEW. Types mirror mobile/src/types/domain.ts. Fetch
  functions via the existing apiFetch<T> wrapper (web/src/api/client.ts).
- Route: /shifts/:shiftId/recommendations, added to ROUTE_ACCESS + wrapped in RoleRoute +
  registered in App.tsx. GET = SUPERVISOR/SAFETY_MANAGER/ADMIN; decide = SUPERVISOR/ADMIN only
  (per docs/api/recommendation.yaml).
- web/src/localization/  — NEW. i18next + 7 locale JSON files mirroring mobile's set, provider
  wired at app root.

VERIFIED FACTS THAT CONSTRAIN THIS DOC (do not invent around these):
- NO --surfaceAlt token on web. Nearest analog: --surface-sunken (#f5f2ec).
- NO --danger token on web. Reject button + Required pill BORROW --band-high (#dc2626) — a
  hazard-band colour repurposed, with an explicit comment in CreateShiftForm.css that this is
  provisional pending CVD review of tokens.css. Open item, carried into §10.
- .card is defined ONCE (web/src/design/global.css) with NO padding — every consumer supplies
  its own padding.
- Web has no react-query/SWR. Data fetching = apiFetch<T> + per-domain function + a
  discriminated-union Load state driven by useEffect/Promise.all with an unmount guard.

DOC LOCATION STANDARD (same as doc #1):
- Design language + platform specs  -> docs/design/
- Architecture decision records      -> docs/adr/   (next free number: 0017)
- Implementation plans               -> docs/plans/
```

---

## 1. Locked decisions and how they constrain this build

| # | Decision | Consequence for the web plan view |
|---|---|---|
| D1 | **Lexend** everywhere | plan-card text inherits `--font-ui`; no new font stack |
| D2 | Theming models stay **different** (web fixed / mobile runtime) | the plan view reads CSS custom properties only — it never imports a mobile theme object, and mobile never reads `tokens.css`. i18n (§7) is a separate axis and does not change this. |
| D3 | Colour reserved for meaning | the plan view's only filled pill is the one status that is asking for a decision (`PENDING_APPROVAL`); everything else is outline or neutral |
| **i18n** (this doc) | Web has **zero** i18n; mobile has 7 locales | to keep the plan view at parity with mobile (the feature it mirrors), this doc proposes standing up i18next on web — see §7. This is scoped to what the plans feature needs, not a full app-wide localisation pass. |

---

## 2. The greenfield web plan-detail view — card anatomy

The web view mirrors mobile's post-refactor `MitigationRow` (doc #1 §8.2–8.3): a **summary tier** that is always visible and scannable, and a **detail tier** that expands on demand. In web idiom the outer wrapper is a `.card` (not a custom card component — web already has one), and disclosure is the `ShiftCard` `aria-expanded` pattern, not a chevron icon component (web has none).

Two levels of card, same as mobile: a **recommendation-level card** (the plan as a whole — status, "why this was drafted") containing one or more **mitigation rows** (the individual proposed actions).

```
┌──────────────────────────────────────────── .card ──┐
│  RECOMMENDATION SUMMARY                                │
│    Recommended plan            [ Awaiting decision ]   │  ← title + STATE pill (filled)
│    Why this was drafted                                │
│    Two workers are on day 1–2 of acclimatisation and…  │  ← rationale, clamped ~3 lines
│    Read more                                            │
│  ─────────────────────────────────────────────────────│
│  MITIGATION ROW (repeats, grouped by category)          │
│    Rest 15 minutes without a break        [ Required ]  │  ← title + ATTRIBUTE pill
│    15 min · every hour                                  │  ← timing phrase
│    [ Meng Hui ]  [ Siti ]  [ +2 ]                        │  ← ENTITY chips, applies-to
│    Show details ⌄                                        │  ← disclosure control
│  ┄ detail (conditionally rendered) ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│    Reason         Worker is on day 2 of acclimatisation…│
│    Rule            UNACCLIMATISED_HEAVY_WORK_RULE        │
│    Expected effect Reduces heat strain by ~15–20%…       │
│  ─────────────────────────────────────────────────────│
│    [ Approve ]                    ( Reject )             │  ← press-to-fill danger, §5
└──────────────────────────────────────────────────────┘
```

- **Summary tier (always rendered):** title, resolved `actionCode → i18n key`, falling back to the raw `action` string when no key exists · **Required/Suggested** attribute pill (from `Mitigation.origin`) · timing phrase (from `MitigationTiming`) · applies-to as **entity chips** with `+N` overflow, or a single "Everyone on this shift" chip (`recommendations.appliesToAll`) when `appliesTo === null` · disclosure control.
- **Detail tier (mounts on expand):** Reason (`rationale`), Rule (`ruleReference`), Expected effect (`estimatedImpact`).
- **Recommendation-level narrative** ("Why this was drafted", `Recommendation.rationale`): clamp to ~3 lines with a "Read more" toggle — mirrors mobile doc #1 §8.3, same reasoning (biggest text block on the screen).

### `Mitigation.appliesTo === null` must say so in words

`appliesTo === null` means the mitigation applies to the **whole shift**, not "no one." A card that renders zero chips for this case is indistinguishable from a data-loading bug. Always render one explicit "Everyone on this shift" entity chip (mobile's `recommendations.appliesToAll` string) instead of leaving the row blank — the same rule doc #1 states for mobile.

### `Mitigation.origin` — Required is danger-toned, Suggested is neutral-toned

Per doc #1 §4, origin is an **attribute** (outlined) pill, not a state pill — most mitigations are `MANDATORY`, so filling every one would drown the one thing on screen that actually needs a decision (the recommendation's own `PENDING_APPROVAL` status). Web maps:

- `origin === "MANDATORY"` → label "Required", tone `--band-high` (borrowed danger — see §10 open item)
- `origin === "ADVISORY"` → label "Suggested", tone `--ink-secondary`

### `Recommendation.mitigations` is always the original draft

Never overwrite `mitigations` with `approval.editedMitigations` in place — they are two different arrays for a reason: `mitigations` is the agent's original proposal, `approval.editedMitigations` (when `approval.decision === "EDITED"`) is what a supervisor changed it to. The UI needs both to render a diff (`what was drafted` vs `what was decided`); collapsing them into one array loses that.

### Component skeleton

`web/src/features/plans/PlanCard.tsx` (**NEW**):

```tsx
/** @author <you> */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Recommendation } from "@/api/recommendations";
import { MitigationRow } from "./MitigationRow";
import { PlanActions } from "./PlanActions";

// status → i18n key (values live in the recommendations block, §7 — ported verbatim from mobile).
const STATUS_KEY: Record<Recommendation["status"], string> = {
  DRAFT: "recommendations.statusDraft",
  PENDING_APPROVAL: "recommendations.pending",
  APPROVED: "recommendations.decidedApproved",
  REJECTED: "recommendations.decidedRejected",
};

export function PlanCard({
  recommendation,
  workerNames,
  canDecide,
  onDecide,
}: {
  recommendation: Recommendation;
  workerNames: Map<string, string>;
  /** SUPERVISOR/ADMIN only, per docs/api/recommendation.yaml — SAFETY_MANAGER is read-only. */
  canDecide: boolean;
  onDecide: (decision: "APPROVED" | "REJECTED") => void;
}) {
  const { t } = useTranslation();
  const [showFullWhy, setShowFullWhy] = useState(false);
  const isPending = recommendation.status === "PENDING_APPROVAL";

  return (
    <article className="plan-card card">
      <header className="plan-card__header">
        <h2 className="plan-card__title">{t("recommendations.title")}</h2>
        {/* STATE pill — filled, reserved for the one thing asking for a decision now. */}
        {isPending && <span className="pill pill--state">{t(STATUS_KEY[recommendation.status])}</span>}
      </header>

      {recommendation.rationale && (
        <div className="plan-card__why">
          <p className="plan-card__why-title">{t("recommendations.whyTitle")}</p>
          <p className={showFullWhy ? undefined : "plan-card__why-text--clamped"}>
            {recommendation.rationale}
          </p>
          <button type="button" className="plan-card__disclosure" onClick={() => setShowFullWhy((v) => !v)}>
            {showFullWhy ? t("recommendations.readLess") : t("recommendations.readMore")}
          </button>
        </div>
      )}

      <div className="plan-card__mitigations">
        {recommendation.mitigations.map((m, i) => (
          <MitigationRow key={i} mitigation={m} workerNames={workerNames} />
        ))}
      </div>

      {canDecide && isPending && <PlanActions onDecide={onDecide} />}
    </article>
  );
}
```

`web/src/features/plans/MitigationRow.tsx` (**NEW**) — the applies-to chip logic and disclosure, mirroring `ShiftCard`'s `useState` + conditional render:

```tsx
/** @author <you> */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Mitigation } from "@/api/recommendations";

const MAX_WORKER_CHIPS = 4;

function timingPhrase(timing: Mitigation["timing"], t: TFunction): string | null {
  // Composed from mobile's actual timing keys (mobile/src/localization/en.json:462-465):
  //   timingDuration "{{duration}} min" · timingEveryMinutes "every {{every}} min"
  //   timingEveryHour "every hour" (the 60-minute special case) · timingStartBy "start by {{time}}"
  if (!timing) return null;
  const parts: string[] = [];
  if (timing.durationMinutes != null) {
    parts.push(t("recommendations.timingDuration", { duration: timing.durationMinutes }));
  }
  if (timing.everyMinutes != null) {
    parts.push(
      timing.everyMinutes === 60
        ? t("recommendations.timingEveryHour")
        : t("recommendations.timingEveryMinutes", { every: timing.everyMinutes }),
    );
  }
  if (timing.startByUtc != null) {
    parts.push(t("recommendations.timingStartBy", { time: new Date(timing.startByUtc).toLocaleTimeString() }));
  }
  return parts.length ? parts.join(" · ") : null;
}

export function MitigationRow({
  mitigation,
  workerNames,
}: {
  mitigation: Mitigation;
  workerNames: Map<string, string>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const appliesToAll = mitigation.appliesTo === null || mitigation.appliesTo.length === 0;
  const names = appliesToAll ? [] : mitigation.appliesTo!.map((id) => workerNames.get(id) ?? id);
  const shown = names.slice(0, MAX_WORKER_CHIPS);
  const overflow = names.length - shown.length;
  const phrase = timingPhrase(mitigation.timing, t);

  return (
    <div className="plan-mitigation">
      <div className="plan-mitigation__summary">
        <div className="plan-mitigation__title-row">
          <p className="plan-mitigation__title">
            {mitigation.actionCode
              ? t(`actions.${mitigation.actionCode}`, { defaultValue: mitigation.action })
              : mitigation.action}
          </p>
          {mitigation.origin && (
            <span
              className={`pill pill--attribute pill--attribute-${
                mitigation.origin === "MANDATORY" ? "required" : "suggested"
              }`}
            >
              {t(mitigation.origin === "MANDATORY" ? "recommendations.originMandatory" : "recommendations.originAdvisory")}
            </span>
          )}
        </div>
        {phrase && <p className="plan-mitigation__timing">{phrase}</p>}

        <div className="plan-mitigation__chips">
          {appliesToAll ? (
            <span className="pill pill--entity">{t("recommendations.appliesToAll")}</span>
          ) : (
            <>
              {shown.map((name, i) => (
                <span key={`${name}-${i}`} className="pill pill--entity">{name}</span>
              ))}
              {overflow > 0 && <span className="pill pill--entity">{`+${overflow}`}</span>}
            </>
          )}
        </div>

        {(mitigation.rationale || mitigation.ruleReference || mitigation.estimatedImpact) && (
          <button
            type="button"
            className="plan-mitigation__disclosure"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t("recommendations.hideDetails") : t("recommendations.showDetails")}
          </button>
        )}
      </div>

      {open && (
        <dl className="plan-mitigation__detail">
          {mitigation.rationale && (
            <>
              <dt>{t("recommendations.rationale")}</dt>
              <dd>{mitigation.rationale}</dd>
            </>
          )}
          {mitigation.ruleReference && (
            <>
              <dt>{t("recommendations.ruleReference")}</dt>
              <dd className="plan-mitigation__rule">{mitigation.ruleReference}</dd>
            </>
          )}
          {mitigation.estimatedImpact && (
            <>
              <dt>{t("recommendations.estimatedImpact")}</dt>
              <dd>{mitigation.estimatedImpact}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
```

---

## 3. The shared web `.pill` — three-role grammar as a new stylesheet

`web/src/features/shifts/ShiftList.css` today defines `.pill` locally, with the comment "Grammar: status pills FILL, intensity pills OUTLINE." That grammar is exactly doc #1's state/attribute distinction — it just doesn't have an entity role yet, because `ShiftList.css` has never needed one. The plans feature needs all three, so this doc lifts `.pill`'s base rule into a shared file both features import, and generalises the modifier names to the three roles.

`web/src/design/pill.css` (**NEW**):

```css
/*
 * Shared pill/chip grammar. One shape, three roles — lifted out of ShiftList.css's `.pill`
 * base rule so shifts and plans render the same visual language (doc #1 §4).
 *
 * STATE   = filled.   Reserved for a status actively asking for a decision right now.
 * ATTRIBUTE = outlined. Classifies the item (Required/Suggested, work intensity).
 * ENTITY  = neutral, ALWAYS bordered. Names an identity (a worker). No semantic colour —
 *           the border is what carries the chip's edge if the fill is ever dropped, so never
 *           rely on fill alone to read this role.
 */
.pill {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

/* STATE — filled wash. Feature-specific tones (e.g. .pill--planned in ShiftList.css) still
   define their own colour; .pill--state below is the plans feature's own instance of the role. */
.pill--state {
  background: var(--status-waiting-wash);
  color: var(--status-waiting);
}

/* ATTRIBUTE — outlined, transparent fill. */
.pill--attribute {
  background: transparent;
  border: 1.5px solid;
}
.pill--attribute-required {
  /* Borrows --band-high (hazard-band red) as the danger tone — no --danger token yet. See §10. */
  color: var(--band-high);
  border-color: var(--band-high);
}
.pill--attribute-suggested {
  color: var(--ink-secondary);
  border-color: var(--ink-secondary);
}

/* ENTITY — neutral fill, always bordered. No --surfaceAlt on web; --surface-sunken is the
   nearest analog (the warm-stone recessed-panel tone already used for inputs). */
.pill--entity {
  background: var(--surface-sunken);
  color: var(--ink);
  border: 1px solid var(--line-strong);
}
```

Import it once, alongside `global.css`, and drop the duplicate base `.pill` rule from `ShiftList.css` in a follow-up (not required to ship the plans feature — `ShiftList.css`'s existing `.pill--planned` / `.pill--intensity-*` modifiers keep working unchanged as long as the base `.pill` rule stays defined somewhere before them in cascade order). Migrating `ShiftList.css` to import the shared file instead of redefining `.pill` is the equivalent of doc #1 §8.1's "migrating the four other mobile pills is a follow-up" note.

---

## 4. Disclosure in web — reuse the `ShiftCard` pattern exactly

No new disclosure primitive. `ShiftCard.tsx` already has the pattern this feature needs: `useState` for open/closed, an `aria-expanded` button, and a **conditionally rendered** body (not CSS `display:none`) — see the component code in §2 (`MitigationRow`'s `open`/`setOpen`, and `PlanCard`'s `showFullWhy`/`setShowFullWhy`).

Styling — reuse `ShiftCard.tsx`'s `.shift-card__disclosure` recipe verbatim for the mitigation-row toggle (`web/src/features/plans/MitigationRow.css`, **NEW**):

```css
.plan-mitigation__disclosure {
  align-self: flex-start;
  margin-top: var(--space-2);
  background: none;
  border: 0;
  padding: 0;
  color: var(--action);
  font: inherit;
  font-weight: var(--weight-medium);
  cursor: pointer;
}
```

This is byte-for-byte the same declaration block as `.shift-card__disclosure` in `ShiftList.css:64-74`. It relies on the global `:focus-visible` outline (defined once in `global.css`) rather than a component-local focus ring — same as `ShiftCard`, no new focus-visible rule needed.

---

## 5. Press-to-fill danger — reuse `.shift-form__danger`

**Reject** is the plan view's one destructive action (Approve is not destructive — it commits the plan as drafted; Reject discards it). Per doc #1 §5, destructive actions are outlined at rest and fill with the danger colour on engage. Web already ships this exact recipe for Cancel Shift: `web/src/features/shifts/CreateShiftForm.css:144-159`, selector `.shift-form button.shift-form__danger`.

`web/src/features/plans/PlanActions.css` (**NEW**) — same recipe, new selector:

```css
.plan-actions__reject {
  background: var(--surface);
  color: var(--band-high);
  border: 1px solid var(--band-high);
}
.plan-actions__reject:hover:not(:disabled) {
  background: var(--band-high);
  color: var(--action-ink);
}
.plan-actions__reject:disabled {
  opacity: 0.6;
}
```

- **`--danger` open item:** this borrows `--band-high` (the WBGT High-Risk hazard-band red) exactly as `.shift-form__danger` does, per the existing code comment that a new token is deliberately withheld while `tokens.css` is under CVD review. Do not invent a `--danger` token for this spec — reconcile both this selector and `.pill--attribute-required` (§3) onto a real one when that review lands. Carried into §10.
- **Reduced motion:** there is no `transition` property in `.shift-form__danger` at all — the colour swap is instant by construction, not zeroed by the `prefers-reduced-motion` media query in `tokens.css:134-139`. `.plan-actions__reject` inherits the same property, so it needs no motion handling of its own.

`web/src/features/plans/PlanActions.tsx` (**NEW**):

```tsx
/** @author <you> */
import { useTranslation } from "react-i18next";

export function PlanActions({ onDecide }: { onDecide: (decision: "APPROVED" | "REJECTED") => void }) {
  const { t } = useTranslation();
  return (
    <div className="plan-actions">
      <button type="button" className="plan-actions__approve" onClick={() => onDecide("APPROVED")}>
        {t("recommendations.approveButton")}
      </button>
      <button type="button" className="plan-actions__reject" onClick={() => onDecide("REJECTED")}>
        {t("recommendations.rejectButton")}
      </button>
    </div>
  );
}
```

---

## 6. Web `Recommendation` type + data layer

### 6.1 Types + fetch functions — `web/src/api/recommendations.ts` (**NEW**)

Types live inline with the fetch functions, in the domain file — same convention as `web/src/api/shifts.ts` (no dedicated `types/` folder on web). This mirrors `mobile/src/types/domain.ts` field-for-field.

```ts
/** @author <you> */
import { apiFetch } from "./client";

export type RecommendationStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
export type MitigationOrigin = "MANDATORY" | "ADVISORY";
export type ApprovalDecision = "APPROVED" | "REJECTED" | "EDITED";

// Ported verbatim from mobile/src/types/domain.ts (mirrors the backend ActionCatalogue).
export type ActionCode =
  | "STOP_WORK"
  | "RESUME_WORK"
  | "REST_10_MIN_HOURLY"
  | "REST_15_MIN_HOURLY"
  | "REST_10_MIN"
  | "REST_15_MIN"
  | "HYDRATE_HOURLY"
  | "HYDRATE_REGULARLY"
  | "HYDRATE"
  | "SHADE_RECOVERY"
  | "SEEK_SHADE"
  | "RESCHEDULE_HEAVY_WORK"
  | "ROTATE_TO_LIGHT_DUTY"
  | "CLOSE_MONITORING";

export type MitigationCategory =
  | "STOP_WORK"
  | "REST"
  | "HYDRATION"
  | "SHADE_COOLING"
  | "WORK_SCHEDULING"
  | "MONITORING";

export interface MitigationTiming {
  durationMinutes: number | null;
  everyMinutes: number | null;
  startByUtc: string | null;
}

export interface Mitigation {
  priority: string | null;
  action: string;
  rationale: string | null;
  estimatedImpact: string | null;
  actionCode: ActionCode | null;
  category: MitigationCategory | null;
  origin: MitigationOrigin | null;
  ruleReference: string | null;
  /** null = applies to the WHOLE shift. Must be rendered as an explicit "All crew" chip — see §2. */
  appliesTo: string[] | null;
  timing: MitigationTiming | null;
}

export interface Approval {
  id: string;
  approverId: string;
  decision: ApprovalDecision;
  reason: string | null;
  editedMitigations: Mitigation[] | null;
  decidedAt: string;
}

export interface Recommendation {
  id: string;
  shiftId: string;
  policyVersion: string | null;
  status: RecommendationStatus;
  rationale: string | null;
  createdAt: string;
  /** Always the agent's ORIGINAL draft — never overwrite. Diff against approval.editedMitigations. */
  mitigations: Mitigation[];
  approval: Approval | null;
}

export function fetchRecommendations(siteId: string, shiftId: string) {
  return apiFetch<Recommendation[]>(`/api/v1/sites/${siteId}/shifts/${shiftId}/recommendations`);
}

export interface DecisionPayload {
  decision: ApprovalDecision;
  reason?: string;
  editedMitigations?: Mitigation[];
}

export function decideRecommendation(
  siteId: string,
  shiftId: string,
  recommendationId: string,
  payload: DecisionPayload,
) {
  return apiFetch<Recommendation>(
    `/api/v1/sites/${siteId}/shifts/${shiftId}/recommendations/${recommendationId}/decision`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}
```

### 6.2 Load state in the page component

Web has no react-query/SWR. The established pattern (`apiFetch<T>` + per-domain function + a discriminated-union `Load` state, driven by `useEffect`/`Promise.all` with an `active` unmount guard, errors mapped via `messageFor()`) carries over unchanged:

```ts
type Load =
  | { status: "loading" }
  | { status: "loaded"; recommendations: Recommendation[]; workerNames: Map<string, string> }
  | { status: "error"; message: string; requestId: string | null };
```

`web/src/features/plans/PlansPage.tsx` (**NEW**, route-level, thin — composes `AppShell` like other pages):

```tsx
/** @author <you> */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchRecommendations, decideRecommendation, type Recommendation } from "@/api/recommendations";
import { ApiError, messageFor } from "@/api/errors";
import { PlanCard } from "./PlanCard";

type Load =
  | { status: "loading" }
  | { status: "loaded"; recommendations: Recommendation[]; workerNames: Map<string, string> }
  | { status: "error"; message: string; requestId: string | null };

export function PlansPage({ siteId, canDecide }: { siteId: string; canDecide: boolean }) {
  const { shiftId } = useParams<{ shiftId: string }>();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setLoad({ status: "loading" });

    Promise.all([
      fetchRecommendations(siteId, shiftId!),
      // fetch worker roster here too, same shape as ShiftCard's workerNames Map prop
    ])
      .then(([recommendations]) => {
        if (!active) return;
        setLoad({ status: "loaded", recommendations, workerNames: new Map() });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const requestId = err instanceof ApiError ? err.requestId : null;
        setLoad({ status: "error", message: messageFor(err), requestId });
      });

    return () => {
      active = false;
    };
  }, [siteId, shiftId]);

  if (load.status === "loading") return <p>Loading…</p>;
  if (load.status === "error") return <p role="alert">{load.message}</p>;

  return (
    <>
      {load.recommendations.map((r) => (
        <PlanCard
          key={r.id}
          recommendation={r}
          workerNames={load.workerNames}
          canDecide={canDecide}
          onDecide={(decision) =>
            decideRecommendation(siteId, shiftId!, r.id, { decision })
              .then(() => setLoad({ status: "loading" })) // simplest re-fetch; refine later
          }
        />
      ))}
    </>
  );
}
```

### 6.3 Route wiring

Per `docs/api/recommendation.yaml`: `GET` is SUPERVISOR/SAFETY_MANAGER/ADMIN; the decide action is SUPERVISOR/ADMIN only. That split means the **route** gates on the GET roles (broader — SAFETY_MANAGER can view), and the **page** additionally gates the Approve/Reject buttons on a narrower `canDecide` check (SUPERVISOR/ADMIN only) — SAFETY_MANAGER reaches a read-only view, not a 403.

`web/src/app/routeAccess.ts` — add an entry to `ROUTE_ACCESS`:

```ts
"/shifts/:shiftId/recommendations": ["SUPERVISOR", "SAFETY_MANAGER", "ADMIN"],
```

`web/src/app/App.tsx` — register inside the `signed-in` branch, same shape as the existing `/shifts/:shiftId/edit` route:

```tsx
<Route
  path="/shifts/:shiftId/recommendations"
  element={
    <RoleRoute roles={rolesForRoute("/shifts/:shiftId/recommendations")}>
      <PlansPage siteId={siteId} canDecide={hasAnyRole(["SUPERVISOR", "ADMIN"])} />
    </RoleRoute>
  }
/>
```

This is a **shift-scoped** detail route, not a top-nav item — it is not added to `web/src/app/navigation.ts`'s `NAVIGATION`. Instead, link to it from `ShiftCard`, the same way `Edit` already does:

```tsx
{canManage && (
  <Link className="shift-card__plan-link" to={`/shifts/${shift.id}/recommendations`}>
    View plan
  </Link>
)}
```

---

## 7. Web i18n infrastructure

Web has zero i18n today — every string in `web/src/**/*.tsx` is hardcoded English JSX. Mobile has 7 locales at `mobile/src/localization/{en,bn,hi,ms,my,ta,zh-Hans}.json`, including an existing `"recommendations": {...}` block (`en.json:405`). Since the plans feature mirrors mobile's recommendation screen directly, this doc proposes standing up i18next on web scoped to this feature, porting the keys that already exist on mobile, and adding the small number this doc introduces new.

**This does not reopen D2.** D2 is about the theme/contrast source (fixed CSS custom properties vs. a runtime `highContrast`/`fontScale` object) — i18n is a string-resolution layer that sits above either theming model and does not change how either platform sources colour or contrast.

### 7.1 Dependencies

```
npm install i18next react-i18next --workspace web
```

### 7.2 Locale files — `web/src/localization/*.json` (**NEW**)

Same 7 locale codes as mobile, so the key set stays a single source of truth to keep in sync by hand until there's tooling for it: `en.json`, `bn.json`, `hi.json`, `ms.json`, `my.json`, `ta.json`, `zh-Hans.json`.

`web/src/localization/en.json` — the `recommendations` block. The keys above the blank line are **ported verbatim** from `mobile/src/localization/en.json:405-471` (the subset this web view uses) — copy the exact key names *and* English strings so the two platforms never drift. The four keys below the blank line are **NEW** (they exist in *neither* locale set today): mobile's disclosure is a chevron icon, so it never needed text labels; doc #1 §8.5 proposes adding them to mobile's refactor, but that refactor is not yet applied — so web introduces them and mobile should adopt the same keys when doc #1 §8.2 lands.

```json
{
  "recommendations": {
    "title": "AI-drafted plans",
    "pending": "Awaiting decision",
    "whyTitle": "Why this was drafted",
    "rationale": "Reason",
    "ruleReference": "Rule",
    "estimatedImpact": "Expected effect",
    "originMandatory": "Required",
    "originAdvisory": "Suggested",
    "appliesToAll": "Everyone on this shift",
    "approveButton": "Approve and send",
    "rejectButton": "Reject",
    "statusDraft": "Draft",
    "decidedApproved": "Approved",
    "decidedRejected": "Rejected",
    "decidedEdited": "Approved with edits",
    "timingDuration": "{{duration}} min",
    "timingEveryMinutes": "every {{every}} min",
    "timingEveryHour": "every hour",
    "timingStartBy": "start by {{time}}",

    "showDetails": "Show details",
    "hideDetails": "Hide details",
    "readMore": "Read more",
    "readLess": "Read less"
  }
}
```

**Key-name corrections from this doc's first draft** (the original spec guessed these before the mobile file was read — do not reintroduce the old names): the status label is `pending`, **not** `awaitingDecision`; the narrative heading is `whyTitle`, **not** `whyDrafted`; the action buttons are `approveButton` ("Approve and send") / `rejectButton`, **not** `approve` / `reject`; the all-crew chip is `appliesToAll` = "Everyone on this shift", **not** "All crew"; the recommendation title is "AI-drafted plans", **not** "Recommended plan". The four `timing*` keys drive `timingPhrase()` in §2 — note the `timingEveryHour` special case (mobile emits "every hour" for the 60-minute interval rather than "every 60 min"). Mobile's block carries ~50 more keys (edit sheet, reject sheet, evidence, pluralised `mitigationCount`) that this greenfield web view does not render yet — port them only when web grows those flows.

Repeat the same key structure with translated values in the other six locale files, mirroring mobile's existing translations for the ported keys and getting the NEW keys translated through the same channel mobile used for its own strings.

### 7.3 Provider — `web/src/localization/i18n.ts` (**NEW**)

```ts
/** @author <you> */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import bn from "./bn.json";
import hi from "./hi.json";
import ms from "./ms.json";
import my from "./my.json";
import ta from "./ta.json";
import zhHans from "./zh-Hans.json";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    bn: { translation: bn },
    hi: { translation: hi },
    ms: { translation: ms },
    my: { translation: my },
    ta: { translation: ta },
    "zh-Hans": { translation: zhHans },
  },
  lng: "en", // web has no locale switcher yet, unlike mobile's runtime picker — fixed to English for now
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
```

Import it once at the app root, alongside the rest of web's app-level setup (`web/src/main.tsx`):

```ts
import "./localization/i18n";
```

### 7.4 Usage in components

```tsx
import { useTranslation } from "react-i18next";

const { t } = useTranslation();
// ...
<span className="pill pill--attribute pill--attribute-required">
  {t("recommendations.originMandatory")}
</span>
```

For `actionCode → i18n title with `action` fallback` (§2), the human-readable ActionCode labels live in mobile's **separate top-level `actions` block** (`mobile/src/localization/en.json:334-349`, keyed by the `ActionCode` value — e.g. `"REST_15_MIN_HOURLY": "Rest 15 minutes without a break, every hour"`), **not** under `recommendations`. Port that `actions` block too. i18next's `defaultValue` option does the `action`-string fallback in one call — no separate branch needed:

```tsx
const title = mitigation.actionCode
  ? t(`actions.${mitigation.actionCode}`, { defaultValue: mitigation.action })
  : mitigation.action;
```

### 7.5 Scope of this proposal

This stands up the infrastructure and ports the `recommendations` key block (plus the top-level `actions` ActionCode-label block it depends on for mitigation titles, §7.4) — it does **not** localise the rest of web (shifts, auth, admin screens stay hardcoded English). A locale switcher is future work; `lng: "en"` is fixed for now, which is consistent with web's single-fixed-theme posture under D2 even though the two are unrelated mechanisms.

---

## 8. Reuse map

Extends doc #1 §7 with the pieces this doc adds (types, data layer, routing, i18n).

| | Mobile reuses | Web reuses |
|---|---|---|
| Card surface | `cardSurface()` (`styles/sharedStyles.ts`) | global `.card` |
| Disclosure | `ExpandChevron` + `useState` | `ShiftCard` `aria-expanded` button pattern (§4) |
| Text | `AppText` (variants/tones, per-language font) | `.eyebrow` + tokens — no multi-script primitive yet; web is Latin-only today |
| Theme | `useTheme()` / `theme.metrics` | CSS custom properties (`tokens.css`) |
| Pills | `components/common/Pill.tsx` (doc #1 §8.1) | **NEW** shared `.pill` (§3, lifted from `ShiftList.css`) |
| Types | `mobile/src/types/domain.ts` | **NEW** `web/src/api/recommendations.ts` (§6.1) |
| Data fetching | mobile's own client layer | `apiFetch<T>` + discriminated `Load` union (§6.2) |
| Routing | mobile navigator | React Router v7, `ROUTE_ACCESS` + `RoleRoute` (§6.3) |
| i18n | i18next, 7 locales, already shipped | **NEW** — i18next stood up for web, same 7 locales (§7) |
| Danger action | `AppButton` `danger` variant, press state (doc #1 §8.4) | `.shift-form__danger` recipe, reused as `.plan-actions__reject` (§5) |

---

## 9. Guardrail gate for web (merge blocker)

Doc #1 §6's gate, restated in web terms. Every change in this doc must survive all of these before merge — same status as doc #1's gate, not a nice-to-have.

- [ ] **Responsive stack < 768px:** the plan card and its mitigation detail stack single-column below 768px — same breakpoint `ShiftCard.css`'s `.shift-card--open` already uses for crew expansion.
- [ ] **No horizontal body scroll** at any viewport width, including with a long `ruleReference` or a long `rationale` string present.
- [ ] **Long rule codes wrap:** `UNACCLIMATISED_HEAVY_WORK_RULE`-length strings wrap inside the detail row, never overflow it.
- [ ] **Long worker lists overflow to `+N`:** `appliesTo` beyond `MAX_WORKER_CHIPS` collapses to an overflow chip, never an unbounded row of names.
- [ ] **Colour always paired with a label:** no pill or chip in this feature is colour-only — every `.pill--state` / `.pill--attribute-*` / `.pill--entity` instance carries its text.
- [ ] **Fixed-theme legibility:** contrast is checked once against web's single navy/warm-stone theme. There is no runtime toggle to re-check against (D2) — this is the one legibility pass this feature needs, not a matrix of modes.

---

## 10. Open items

Carried forward, not resolved by this doc:

1. **Web `--danger` token.** Both `.plan-actions__reject` (§5) and `.pill--attribute-required` (§3) borrow `--band-high` (the WBGT High-Risk hazard-band red) as a stand-in danger colour, matching the existing `.shift-form__danger` pattern and its code comment that a new token is deliberately withheld while `tokens.css` is under CVD review. Reconcile all three selectors onto a real `--danger` token once that review lands — do not add one piecemeal before then.
2. **`border-colorvar` typo** at `WorkIntensitySegmented.css:45` — a pre-existing bug noticed during this work, unrelated to the plans feature. Out of scope here; carried forward for a separate fix.
3. **ADR-0012's Lexend tabular-figures claim** is unverified — carried forward from the design-system decision record, not re-checked as part of this spec.

---

## 11. Where this document lives in the repo

Same convention as doc #1.

| Document kind | Repo path | Example |
|---|---|---|
| **Design language / platform spec** (doc #1, this doc) | `docs/design/` | `docs/design/crewsafe-web-plan-card-spec.md` |
| **ADR** | `docs/adr/` (next free number) | `docs/adr/0017-card-pill-design-language.md` |
| **Implementation plan** | `docs/plans/` | matches existing `SCRUM-###-*-plan.md` files |

**Path:** Desktop first (`~/Desktop/NUS-ISS/AD_Guides/Frontend_Design/crewsafe-web-plan-card-spec.md`), Justin reviews, then push to `docs/design/crewsafe-web-plan-card-spec.md` alongside doc #1 — this is document #2 of the roadmap doc #1 §10 lays out (doc #1 → this doc → ADR 0017 → the reference artifact → the gated token-substrate merge).
