/**
 * The side effects that must happen whenever the store moves, wherever it was moved from.
 *
 * ── WHY MIDDLEWARE RATHER THAN CALL SITES ───────────────────────────────────────────────
 * Two of these are cancellations, and a missed cancellation is the specific failure this
 * whole feature has to avoid: a phone buzzing "your rest is over" for a rest that was called
 * off. A rest can end early from several places — the card is swiped, the countdown reaches
 * zero, the worker signs out, a dev reset clears the inbox — and asking each of those screens
 * to remember costs one forgotten line to reintroduce the bug.
 *
 * Redux already knows about every one of them, because they all dispatch. Listening to the
 * actions is the only version of this that cannot be forgotten by the next person to add a
 * fifth way of dismissing a card.
 *
 * ── WHY NOT IN THE REDUCERS ─────────────────────────────────────────────────────────────
 * Scheduling and cancelling are asynchronous calls into the operating system. A reducer that
 * did them would no longer be a pure function of its inputs, and `dispatchInboxSlice`'s
 * reducers are exercised directly by its tests — which would then be scheduling real
 * notifications.
 *
 * @author Justin Chua
 */
import { createListenerMiddleware, isAnyOf } from "@reduxjs/toolkit";

import {
  acknowledge,
  dismissed,
  resetAcknowledgements,
} from "./reducers/dispatchInboxSlice";
import { loadRecommendations } from "./reducers/recommendationsSlice";
import { sessionExpired, signOut } from "./reducers/authSlice";
import { planIdsAnnounced, seenPlansSeeded } from "./reducers/notificationsSlice";
import { cancelAllScheduled } from "@/notifications/notificationClient";
import {
  cancelRestEndNotification,
  scheduleRestEndNotification,
} from "@/notifications/restNotifications";
import { announceDraftedPlans, isAwaitingDecision } from "@/notifications/planNotifications";
import type { RootState } from "./store";

export const notificationListener = createListenerMiddleware();

/* ───────────────────────────── The worker's rest ───────────────────────────── */

notificationListener.startListening({
  actionCreator: acknowledge.fulfilled,
  effect: async (action, api) => {
    const state = api.getState() as RootState;
    if (state.preferences.notificationsMuted) return;

    const { dispatchId } = action.meta.arg;
    const record = state.dispatchInbox.acknowledged[dispatchId];

    /*
     * Only a real rest. `hasRestTimer` is false for a HYDRATE card and for an unparseable
     * duration, both of which still get a three-minute dwell before the card tidies itself
     * away — and a notification saying "your rest is over" for a card that was only being
     * cleared would be telling the worker about a rest they never took.
     */
    if (!record?.hasRestTimer || record.dismissAt === null) return;

    const startedAt = Date.parse(record.acknowledgedAt);
    if (Number.isNaN(startedAt)) return;

    await scheduleRestEndNotification({
      dispatchId,
      startedAt,
      dismissAt: record.dismissAt,
    });
  },
});

notificationListener.startListening({
  actionCreator: dismissed,
  effect: async (action) => {
    /*
     * Fires for both ways a card leaves: swiped away early, and expired naturally.
     *
     * Cancelling on the natural expiry looks redundant and is not. The notification is due at
     * exactly that instant, so whether it has already been delivered is a race — and if the
     * app's clock got there first, the pending one is still sitting in the OS. Cancelling an
     * identifier that has already fired is a no-op, so the defensive call costs nothing and
     * the alternative is a duplicate buzz seconds after the card cleared itself.
     */
    await cancelRestEndNotification(action.payload);
  },
});

notificationListener.startListening({
  matcher: isAnyOf(
    resetAcknowledgements,
    signOut.fulfilled,
    signOut.rejected,
    sessionExpired.fulfilled,
  ),
  effect: async () => {
    /*
     * Everything, because neither action leaves anything to cancel individually.
     *
     * Sign-out matters most, and on a shared site phone it is not an edge case: without this,
     * the next worker to pick up the handset is buzzed about the previous worker's rest,
     * naming a duration they never took.
     *
     * All three sign-out endings are covered, including the rejected one. `signOut.rejected`
     * still clears the session — the slice is explicit that someone who asked to leave leaves
     * regardless — so treating it as "no sign-out happened" here would leave notifications
     * scheduled against a user who is already gone.
     */
    await cancelAllScheduled();
  },
});

/* ───────────────────────── The supervisor's drafted plans ───────────────────────── */

notificationListener.startListening({
  actionCreator: loadRecommendations.fulfilled,
  effect: async (action, api) => {
    const state = api.getState() as RootState;
    const user = state.auth.user;

    // Supervisors only, as decided. Safety managers see plans on the oversight screen but do
    // not decide them, and the backend's role split for shift actions is unsettled enough
    // that widening this quietly would be the wrong way to settle it.
    if (user?.role !== "SUPERVISOR") return;
    if (state.preferences.notificationsMuted) return;

    /*
     * Not while the supervisor is looking at the list.
     *
     * `RecommendationsScreen` already announces an arriving plan with a toast, and `uiSlice`'s
     * own header states the rule: a notice is for a result that is NOT visible on the screen
     * the user ends up on. Firing both would report one event twice, half a second apart, to
     * someone whose eyes are already on the row.
     *
     * The seen-set is still updated below, so a plan that arrived while the list was open is
     * not announced later as though it were new — it was announced, just by the toast.
     */
    const plansListOpen = state.ui.plansListFocused;

    const awaiting = action.payload.filter(isAwaitingDecision);
    const seen = state.notifications.seenPlanIdsByUser[user.id];

    /*
     * First successful load for this account on this device: record, do not announce.
     *
     * Without this the first poll after signing in treats every plan on the site as new, and
     * a supervisor picking up the phone at the start of a shift is met with a notification
     * for each plan drafted while they were away. Seeding uses the same `isAwaitingDecision`
     * filter as announcing, so a plan that was decided at seed time and somehow reopened
     * later is correctly treated as new rather than as already-seen.
     */
    if (seen === undefined) {
      api.dispatch(
        seenPlansSeeded({ userId: user.id, planIds: awaiting.map((plan) => plan.id) }),
      );
      return;
    }

    const fresh = awaiting.filter((plan) => !seen.includes(plan.id));
    if (fresh.length === 0) return;

    const sent = plansListOpen
      ? false
      : await announceDraftedPlans(fresh, action.meta.arg.siteId);

    /*
     * Recorded whether or not the notification was actually delivered.
     *
     * The alternative — only recording on success — sounds more careful and is worse: with
     * permission refused, `announceDraftedPlans` returns false every time, so the same plans
     * would be "new" on every poll forever, and the moment permission was later granted the
     * supervisor would receive a notification for every plan drafted since they refused.
     *
     * The set records what this device has HAD THE CHANCE to announce, not what arrived.
     */
    void sent;
    api.dispatch(planIdsAnnounced({ userId: user.id, planIds: fresh.map((plan) => plan.id) }));
  },
});
