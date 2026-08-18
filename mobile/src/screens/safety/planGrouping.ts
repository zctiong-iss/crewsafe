/**
 * Which of a site's plans a safety manager actually needs to see (SCRUM-TBD-110).
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────────────────
 * A site accumulates a plan per band transition — five or more within an hour on a volatile
 * day — and the Oversight card listed all of them. Almost every one is history: superseded
 * the moment conditions moved again. The manager scrolls past four dead rows to reach the
 * live one.
 *
 * ── WHY PER SHIFT AND NOT PER SITE ──────────────────────────────────────────────────────
 * A site's plans are gathered across ALL its shifts, so "the site's latest plan" would hide a
 * decision awaiting a supervisor on one crew because an unrelated crew got a newer draft.
 * Grouping by shift first means nothing can be hidden by activity somewhere a manager was not
 * looking.
 *
 * ── WHY A STOP-WORK IS NEVER COLLAPSED ──────────────────────────────────────────────────
 * An `AUTO_DISPATCHED` plan was sent to a crew without approval (SCRUM-440). It is a live
 * instruction, not a record of one — hiding it because something newer exists would take the
 * most severe thing the system can show off the screen built to oversee it.
 *
 * Worth knowing, because it is the obvious next question: the server never supersedes one
 * either. `AgentDraftService.supersedeOpenRecommendation` selects only `PENDING_APPROVAL`, so
 * no other status can be superseded by any path. This is a display rule reinforcing an
 * invariant that already holds, not a client-side patch over a server-side gap.
 *
 * @author Justin Chua
 */
import type { Recommendation } from "@/types/domain";
import type { PlanShift } from "@/store/reducers/oversightSlice";

export interface ShiftPlanGroup {
  shiftId: string;
  /** Absent when the plan's shift is not among those fetched — see `groupPlansByShift`. */
  shift: PlanShift | null;
  /**
   * What shows at rest: the newest plan, plus any in-force stop-work not already among them.
   * Never empty for a group that exists.
   */
  current: Recommendation[];
  /** Everything else, newest first. Reachable behind a disclosure, never dropped. */
  earlier: Recommendation[];
}

/**
 * Splits one site's plans into per-shift groups.
 *
 * `items` is expected newest-first — `oversightSlice` sorts it there so every consumer
 * inherits the order. This function relies on that rather than re-sorting, so a caller that
 * hands it an unsorted array gets an honestly wrong answer instead of a quietly corrected one.
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

  return [...byShift.entries()].map(([shiftId, plans]) => {
    const [newest, ...rest] = plans;

    /*
     * Any stop-work still in force, other than the newest plan itself.
     *
     * Pulled out of `rest` rather than filtered from the whole list, so the newest plan is
     * never duplicated when it happens to be the stop-work.
     */
    const dispatched = rest.filter((plan) => plan.status === "AUTO_DISPATCHED");
    const dispatchedIds = new Set(dispatched.map((plan) => plan.id));

    return {
      shiftId,
      // A plan can reference a shift the fetch did not return — a shift moved site, or was
      // deleted after its plans were drafted. The group still renders; it just has no window.
      shift: shifts.find((shift) => shift.id === shiftId) ?? null,
      current: [newest, ...dispatched],
      earlier: rest.filter((plan) => !dispatchedIds.has(plan.id)),
    };
  });
}
