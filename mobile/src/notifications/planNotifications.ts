/**
 * Telling a supervisor that a plan was drafted for them to decide on.
 *
 * ── WHAT "WHEN THE AI DRAFTS A PLAN" ACTUALLY MEANS HERE ────────────────────────────────
 * Nothing tells the client. There is no push channel, no recommendations SSE endpoint (the
 * backend has two — `/conditions/stream` and `/actions/stream` — but not this one), and no
 * device token registry. `RecommendationsScreen` polls every 60 seconds against a server
 * auto-trigger that runs every two minutes, so the event this module fires on is not "a plan
 * was drafted" but "a poll returned a plan this device has not seen".
 *
 * The practical consequences, stated here because they are easy to mistake for bugs:
 *
 *   • The notification lands 60–120 seconds after drafting, not at the moment of it.
 *   • Nothing fires if the app has been force-closed, because a poll cannot run.
 *   • Nothing fires while the supervisor is signed out, for the same reason.
 *
 * Closing that gap needs real push, which needs a development build, EAS credentials and a
 * backend that knows about devices. That is a separate story on purpose.
 *
 * ── WHY ONLY PLANS AWAITING A DECISION ──────────────────────────────────────────────────
 * A plan that arrives already approved, rejected or superseded is not asking the supervisor
 * for anything, and buzzing about it spends the one signal this app has on something with no
 * action attached. The auto-trigger can and does supersede its own drafts between polls, so
 * this is a real case rather than a theoretical one.
 *
 * @author Justin Chua
 */
import i18n from "@/localization/i18n";
import type { Recommendation } from "@/types/domain";
import { presentNow } from "./notificationClient";

/** Data keys round-tripped to the tap handler, so the notification can open its own plan. */
export const PLAN_NOTIFICATION_DATA = {
  kind: "plan-drafted",
} as const;

/**
 * The ones worth interrupting someone for.
 *
 * Exported for the store listener, which needs the same filter to decide what to seed — if
 * seeding used a different rule from notifying, a plan that was decided at seed time and
 * reopened later would notify as though it were new.
 */
export function isAwaitingDecision(plan: Recommendation): boolean {
  return plan.status === "PENDING_APPROVAL";
}

/**
 * Announce newly-seen plans.
 *
 * ── ONE NOTIFICATION, NOT ONE PER PLAN ──────────────────────────────────────────────────
 * The auto-trigger drafts per shift, so a supervisor running four shifts can have four plans
 * appear in the same poll. Four notifications in one second is not four times as useful as
 * one — it is a phone that has to be silenced, and the next real one gets silenced with it.
 * So a single plan names itself and a batch is counted.
 *
 * Returns whether anything was sent, so the caller only records ids it actually announced.
 * Never throws: a supervisor whose OS refused the notification must still find the plan on
 * the Plans tab, which is where it was going to be either way.
 */
export async function announceDraftedPlans(
  plans: Recommendation[],
  siteId: string,
): Promise<boolean> {
  if (plans.length === 0) return false;

  /*
   * One key with a count rather than two fixed strings.
   *
   * `RecommendationsScreen`'s toast uses two fixed keys deliberately, because `showToast`
   * carries no interpolation values and widening the store for one message would be the wrong
   * trade. Nothing constrains this path the same way, and a notification read on a lock screen
   * with no list behind it is the one place the actual number earns its keep.
   */
  const body = i18n.t("notifications.planDraftedBody", { count: plans.length });

  return presentNow(i18n.t("notifications.planDraftedTitle"), body, {
    ...PLAN_NOTIFICATION_DATA,
    /*
     * Only carried for a single plan. A batch has no one plan to open, and picking the first
     * arbitrarily would drop a supervisor into one of four decisions with no sign that the
     * other three exist — worse than landing on the list that shows all of them.
     */
    ...(plans.length === 1
      ? {
          // All three, because the detail route is nested under site and shift — a
          // recommendation id alone cannot be fetched or decided on. Carrying only the id
          // would produce a notification that opens a screen with nothing to show.
          siteId,
          shiftId: plans[0].shiftId,
          recommendationId: plans[0].id,
        }
      : {}),
  });
}
