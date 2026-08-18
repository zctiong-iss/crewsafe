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
 * ── A STOP-WORK IS ALWAYS SHOWN, BUT ONLY THE LATEST ONE ────────────────────────────────
 * An `AUTO_DISPATCHED` plan was sent to a crew without approval (SCRUM-440). It is a live
 * instruction, not a record of one, so one is always in `current` — hiding it because
 * something newer exists would take the most severe thing the system can show off the screen
 * built to oversee it.
 *
 * What changed: only the NEWEST stop-work per shift stays there. This file originally kept
 * every one, on the reasoning that the server never supersedes an `AUTO_DISPATCHED` —
 * `AgentDraftService.supersedeOpenRecommendation` selects only `PENDING_APPROVAL` — so two
 * live instructions could genuinely coexist.
 *
 * That reasoning was right about the server and wrong about the crew. While lightning holds,
 * the auto-trigger redrafts every two minutes and each run writes another dispatch, so a
 * thirty-minute storm leaves roughly fifteen of them on one shift. They are not fifteen
 * instructions — they are one instruction, restated. Listing them all pushed every other
 * site's plans off the screen and said the same thing fifteen times, which is how a manager
 * learns to scroll past the row that matters.
 *
 * Nothing is discarded: the older dispatches move to `earlier`, behind the same disclosure as
 * the rest of a shift's history.
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
     * The one stop-work worth surfacing beneath the newest plan.
     *
     * `find` rather than `filter`, and that single word is the whole behaviour change: `items`
     * is newest-first, so the first match is the latest dispatch, and the repeats behind it
     * fall through to `earlier`.
     *
     * Skipped entirely when the newest plan is itself the stop-work — otherwise the same row
     * would appear twice in `current`.
     */
    const latestDispatched =
      newest.status === "AUTO_DISPATCHED"
        ? undefined
        : rest.find((plan) => plan.status === "AUTO_DISPATCHED");

    const current = latestDispatched ? [newest, latestDispatched] : [newest];
    const currentIds = new Set(current.map((plan) => plan.id));

    return {
      shiftId,
      // A plan can reference a shift the fetch did not return — a shift moved site, or was
      // deleted after its plans were drafted. The group still renders; it just has no window.
      shift: shifts.find((shift) => shift.id === shiftId) ?? null,
      current,
      // Everything not on show, including the superseded stop-works. Derived from `current`
      // rather than from a separate id set, so the two cannot disagree about what is hidden.
      earlier: rest.filter((plan) => !currentIds.has(plan.id)),
    };
  });
}
