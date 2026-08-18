/**
 * Telling a worker their rest is over, with the phone in a pocket.
 *
 * ── WHY THIS IS SCHEDULED AT ACKNOWLEDGEMENT AND NOT FIRED AT EXPIRY ────────────────────
 * `RestProgressBar` already notices the deadline passing and calls `onComplete`. That is
 * enough to clear the card and report the rest, and it is not enough to tell anyone: it is a
 * JavaScript timer, so it only runs while the app is alive and in the foreground. A worker
 * resting for ten minutes has pocketed the phone, and a rest signal that requires them to be
 * staring at the screen is a signal for a rest they were not really taking.
 *
 * So the notification is handed to the operating system the moment the worker acknowledges,
 * using the deadline `dismissAtFor` has already computed and persisted. The OS delivers it
 * whether the app is backgrounded, the screen is off, or the process has been killed since.
 *
 * ── CANCELLATION IS THE HALF THAT WILL BITE ─────────────────────────────────────────────
 * A scheduled notification outlives the thing that scheduled it. A rest that is called off,
 * a card swiped away, a worker signing out — each leaves a notification sitting in the OS
 * with this app's name on it, ready to buzz "your rest is over" for a rest that never
 * happened. That is worse than sending nothing, because it is a safety app telling someone a
 * falsehood about their own break, and they have no way to tell it apart from a true one.
 *
 * Every path that ends a rest early therefore cancels, and the store's listener middleware is
 * what guarantees that rather than each screen remembering to.
 *
 * @author Justin Chua
 */
import i18n from "@/localization/i18n";
import { cancelScheduledFor, scheduleAt } from "./notificationClient";

/**
 * The data key a rest notification is tagged with, and cancelled by.
 *
 * The dispatch id rather than a generated one: it is the thing every cancellation path
 * already has in hand, and it means the OS's own list is the record of what is pending. See
 * `cancelScheduledFor` for why there is no table of identifiers anywhere.
 */
const DISPATCH_ID_KEY = "restDispatchId";

/** Round to whole minutes for the copy. A worker does not want "9 minutes 58 seconds". */
function minutesBetween(startedAt: number, endsAt: number): number {
  return Math.max(1, Math.round((endsAt - startedAt) / 60_000));
}

interface RestNotificationRequest {
  dispatchId: string;
  /** Epoch ms of the acknowledgement — the moment the rest began. */
  startedAt: number;
  /** Epoch ms the rest ends, as persisted on the acknowledgement record. */
  dismissAt: number;
}

/**
 * Schedule the "rest is over" notification, replacing any already pending for this dispatch.
 *
 * The cancel-first is not defensive tidiness. The same dispatch can be acknowledged twice —
 * a retry after a network failure is the designed behaviour, not an edge case — and without
 * it the worker's phone would buzz once per attempt at the same moment.
 *
 * Never throws, and returns nothing. The card's own countdown is the real feature; this is an
 * addition to it, and a worker whose OS refused the schedule must still get their rest.
 */
export async function scheduleRestEndNotification({
  dispatchId,
  startedAt,
  dismissAt,
}: RestNotificationRequest): Promise<void> {
  await cancelScheduledFor(DISPATCH_ID_KEY, dispatchId);

  const minutes = minutesBetween(startedAt, dismissAt);

  await scheduleAt({
    title: i18n.t("notifications.restEndTitle"),
    /*
     * States the duration, which is what the requirement asks for and what makes this
     * readable on a lock screen with no other context. Derived from the two timestamps the
     * schedule itself was built from, NOT from a clock at delivery: the notification is
     * describing the rest that was agreed at acknowledgement, and a device whose clock moved
     * in between must not be able to change what the worker is told they were owed.
     */
    body: i18n.t("notifications.restEndBody", { count: minutes }),
    at: dismissAt,
    data: { [DISPATCH_ID_KEY]: dispatchId },
  });
}

/**
 * Withdraw the pending notification for one dispatch.
 *
 * Called whenever a rest stops being owed for any reason other than running its course —
 * and also when it *does* run its course, because a delivered notification is not what is
 * being cancelled here; a still-pending one on a second device clock is.
 */
export async function cancelRestEndNotification(dispatchId: string): Promise<void> {
  await cancelScheduledFor(DISPATCH_ID_KEY, dispatchId);
}
