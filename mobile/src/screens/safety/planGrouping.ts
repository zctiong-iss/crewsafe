/**
 * Which single plan a safety manager sees for each shift (SCRUM-TBD-110).
 *
 * ── ONE PLAN PER SHIFT, ENFORCED BY THE TYPE ────────────────────────────────────────────
 * `ShiftPlanGroup.plan` is one `Recommendation`, not a list. That is deliberate: this file has
 * twice grown a second row back — once as "every stop-work is live, so keep them all", once as
 * "keep the newest stop-work beneath a newer plan" — and both times the shape allowed it. A
 * single field makes "show two" a compile error rather than a judgement call.
 *
 * A site collects a plan per band transition, and while lightning holds the auto-trigger
 * redrafts every two minutes. Listing them made a manager scroll past dead rows to reach the
 * live one, which is the opposite of oversight.
 *
 * ── WHAT WINS ───────────────────────────────────────────────────────────────────────────
 * One question decides it: what is actually in force for this crew right now?
 *
 *   AUTO_DISPATCHED   a stop-work went to the crew without approval (SCRUM-440). In force.
 *   APPROVED          a supervisor approved a plan. In force.
 *   everything else   PENDING_APPROVAL, SUPERSEDED, REJECTED, DRAFT. Nothing is instructing
 *                     anyone: a draft awaiting a decision has not been acted on, and the rest
 *                     are history.
 *
 * The newest IN-FORCE plan wins. Only when a shift has none does the newest plan of any kind
 * show — which is what keeps a lone pending draft visible on a shift where nothing has been
 * decided yet.
 *
 * ── WHY A PENDING DRAFT MUST NOT DISPLACE EITHER ────────────────────────────────────────
 * This is the case that keeps being got wrong, and it fails in the dangerous direction. The
 * agent redrafts on its own every two minutes, so a shift under an active stop-work is
 * CONSTANTLY acquiring newer PENDING_APPROVAL plans. Under newest-wins the stop-work banner
 * would vanish within two minutes of being dispatched, replaced by "Awaiting decision" — the
 * screen would stop showing that a crew had been told to shelter, because a machine drafted a
 * suggestion nobody has looked at.
 *
 * The same holds against an APPROVED plan: a regenerated draft is a proposal, and a proposal
 * does not replace the instruction a supervisor actually signed off.
 *
 * ── WHY PER SHIFT AND NOT PER SITE ──────────────────────────────────────────────────────
 * A site's plans are gathered across ALL its shifts, so "the site's latest plan" would hide a
 * decision awaiting a supervisor on one crew because an unrelated crew got a newer draft.
 * Grouping by shift first means nothing can be hidden by activity somewhere a manager was not
 * looking.
 *
 * @author Justin Chua
 */
import type { Recommendation } from "@/types/domain";
import type { PlanShift } from "@/store/reducers/oversightSlice";

/**
 * The statuses that mean something is instructing a crew right now.
 *
 * Named and exported so the rule is greppable and directly testable, rather than living as two
 * string comparisons inside a `find` that reads like an implementation detail.
 */
export const IN_FORCE_STATUSES: readonly Recommendation["status"][] = [
  "AUTO_DISPATCHED",
  "APPROVED",
];

export function isInForce(plan: Recommendation): boolean {
  return IN_FORCE_STATUSES.includes(plan.status);
}

export interface ShiftPlanGroup {
  shiftId: string;
  /** Absent when the plan's shift is not among those fetched — see `groupPlansByShift`. */
  shift: PlanShift | null;
  /** The one plan this shift shows. Never null: a group only exists because a plan made it. */
  plan: Recommendation;
}

/**
 * Reduces one site's plans to a single plan per shift.
 *
 * `items` is expected newest-first — `oversightSlice` sorts it there so every consumer
 * inherits the order. This relies on that rather than re-sorting, so a caller that hands it an
 * unsorted array gets an honestly wrong answer instead of a quietly corrected one.
 *
 * Groups come back in the order their shifts first appear in `items`, which is newest-plan
 * first: the crew with the most recent activity leads.
 */
export function groupPlansByShift(
  items: readonly Recommendation[],
  shifts: readonly PlanShift[],
): ShiftPlanGroup[] {
  const byShift = new Map<string, Recommendation[]>();

  for (const plan of items) {
    const existing = byShift.get(plan.shiftId);
    if (existing) existing.push(plan);
    else byShift.set(plan.shiftId, [plan]);
  }

  return [...byShift.entries()].map(([shiftId, plans]) => ({
    shiftId,
    // A plan can reference a shift the fetch did not return — a shift moved site, or was
    // deleted after its plans were drafted. The group still renders; it just has no window.
    shift: shifts.find((shift) => shift.id === shiftId) ?? null,
    /*
     * `find` over a newest-first list, so this is the newest in-force plan. A newer stop-work
     * beats an older approval and a newer approval beats an older stop-work — the intended
     * reading of both: whichever instruction was issued last is the one standing.
     *
     * The fallback is `plans[0]` rather than anything cleverer. With nothing in force there is
     * no instruction to prefer, so the newest plan — usually the pending draft — is simply the
     * most useful thing to show.
     */
    plan: plans.find(isInForce) ?? plans[0],
  }));
}
