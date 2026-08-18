/**
 * The one place the app talks to the operating system's notification service.
 *
 * ── WHY A BOUNDARY MODULE AT ALL ────────────────────────────────────────────────────────
 * Two features need notifications — a supervisor's drafted plan and a worker's finished rest
 * — and both would otherwise have to know about Android channels, iOS authorisation, Expo
 * Go's limits and the difference between presenting now and scheduling for later. Behind one
 * module they know none of it, and a test can replace the whole operating system with a
 * jest mock instead of the four expo-notifications entry points it would otherwise reach.
 *
 * ── WHAT EXPO GO CAN AND CANNOT DO, BECAUSE IT SHAPES BOTH FEATURES ─────────────────────
 * This project runs in Expo Go: there is no `android/`, no `ios/` and no `eas.json`. Since
 * Expo SDK 53 remote push notifications are not supported in Expo Go on Android, and there
 * is no push infrastructure on the backend either — no device token registry, no FCM or APNs
 * credentials. LOCAL and SCHEDULED notifications do still work, and they are all this module
 * offers. Nothing here sends a push, and nothing here can fire while the app is force-closed
 * unless it was scheduled beforehand.
 *
 * That is why the rest timer is fully solved and the drafted plan is not: a rest deadline is
 * known at acknowledgement and can be handed to the OS in advance, whereas a plan's existence
 * is only discovered by polling, which requires the app to be running.
 *
 * ── NOTIFICATIONS ARE ALWAYS AN ADDITION, NEVER THE ONLY CHANNEL ────────────────────────
 * Every function here can fail — permission refused, Expo Go on a platform that has dropped
 * support, an OS that silently drops a schedule. None of them throw. A safety app whose
 * worker missed their rest-end signal must not be an app that made that signal
 * notification-only, so every caller is expected to keep working when these return false.
 *
 * @author Justin Chua
 */
import { Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

/*
 * ── DO NOT COLLAPSE THESE INTO `import * as Notifications from "expo-notifications"` ─────
 * That barrel is FATAL on Android in Expo Go, and fatal at import time rather than at call
 * time — the app dies on the red screen before the first render.
 *
 * `expo-notifications/build/index.js` re-exports `DevicePushTokenAutoRegistration.fx`, and
 * that module calls `addPushTokenListener()` at module scope to keep a device push token in
 * sync with a registration server. Since SDK 53 `warnOfExpoGoPushUsage()` THROWS rather than
 * warns when it is reached on Android inside Expo Go, so merely evaluating the barrel throws.
 * Nothing about this app asks for a push token; it is a side effect of the package's own
 * index, and it is unreachable any other way.
 *
 * Importing each submodule directly skips that file entirely. Every one of these is a leaf
 * that pulls in nothing but `expo-modules-core` and its own native module — none of them
 * touch the push-token path — and Metro still resolves the platform variants (the channel
 * helper has a real `.android.js` and a no-op default, which is exactly the behaviour we
 * want on iOS).
 *
 * The cost is a dependency on the package's internal file layout, which is why it is written
 * down here: if a future SDK moves these files, this is the first place to look, and the fix
 * is to follow them rather than to go back through the index.
 */
import { setNotificationHandler } from "expo-notifications/build/NotificationsHandler";
import {
  getPermissionsAsync,
  requestPermissionsAsync,
} from "expo-notifications/build/NotificationPermissions";
import {
  addNotificationResponseReceivedListener,
  getLastNotificationResponseAsync,
} from "expo-notifications/build/NotificationsEmitter";
import { scheduleNotificationAsync } from "expo-notifications/build/scheduleNotificationAsync";
import { cancelScheduledNotificationAsync } from "expo-notifications/build/cancelScheduledNotificationAsync";
import { cancelAllScheduledNotificationsAsync } from "expo-notifications/build/cancelAllScheduledNotificationsAsync";
import { getAllScheduledNotificationsAsync } from "expo-notifications/build/getAllScheduledNotificationsAsync";
import { setNotificationChannelAsync } from "expo-notifications/build/setNotificationChannelAsync";
import { AndroidImportance } from "expo-notifications/build/NotificationChannelManager.types";
import { SchedulableTriggerInputTypes } from "expo-notifications/build/Notifications.types";

/**
 * The Android channel every CrewSafe notification is posted to.
 *
 * ── THE PART THAT IS ONLY WRONG ONCE ────────────────────────────────────────────────────
 * A channel's importance and vibration pattern are fixed when it is created. Android
 * deliberately ignores later changes to an existing channel, because the user is allowed to
 * override them and an app must not be able to override the user back. So a channel shipped
 * with the wrong importance stays wrong on every device that installed before the fix, until
 * the app is reinstalled — the version string in the id is the escape hatch for that,
 * letting a corrected channel ship under a new id rather than a new install.
 */
const ANDROID_CHANNEL_ID = "crewsafe-alerts-v1";

/**
 * The vibration the requirement asks for, on the platform that can honour it.
 *
 * Wait, buzz, pause, buzz. Two pulses rather than one long one because this fires against a
 * phone in a hi-vis pocket under machinery noise, where a single buzz is easy to lose in the
 * ambient shake of a site. The pattern belongs to the channel rather than to each send, which
 * is what makes it survive the app being backgrounded.
 *
 * iOS has no equivalent. React Native's `Vibration` API accepts a pattern there and silently
 * ignores it — every call produces the same fixed buzz — so no code in this app pretends
 * otherwise. On iOS the vibration comes from the notification's sound, which the OS pairs
 * with a haptic automatically, and which respects the ring/silent switch as decided.
 */
const ANDROID_VIBRATION_PATTERN = [0, 400, 200, 400];

/** What the OS will tell us about our permission, normalised across the two platforms. */
export type NotificationPermission = "granted" | "denied" | "undetermined";

/**
 * True when running inside Expo Go rather than a development or production build.
 *
 * Read once: the execution environment cannot change while the process is alive, and the
 * alternative is every call site paying for a lookup to learn something constant.
 */
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Whether this build can schedule local notifications at all.
 *
 * Local notifications work in Expo Go on both platforms today, so this is `true` in practice
 * — it exists so that the day a platform drops them, one constant changes and every caller
 * degrades to its in-app path rather than each of them growing its own guard.
 */
export const canScheduleNotifications = true;

/** Exported for the diagnostics line in Settings, and to keep the constant testable. */
export const isExpoGo = IS_EXPO_GO;

/**
 * Set up once, at startup, before anything is sent.
 *
 * Both halves have to happen early for opposite reasons. The Android channel must exist
 * before the first notification is posted, or that notification is delivered against a
 * default channel and the vibration pattern above never applies. The foreground handler must
 * be registered before the first notification arrives, or iOS falls back to showing nothing
 * while the app is open — and the rest timer fires at a moment the worker may well be looking
 * at the screen, which would make the feature look broken on one platform only.
 *
 * Idempotent, and never throws. Called from the app root, where a rejected promise would take
 * the whole app down over a notification channel.
 */
export async function configureNotifications(): Promise<void> {
  setNotificationHandler({
    handleNotification: async () => ({
      /*
       * Shown even with the app in the foreground.
       *
       * The alternative — suppressing it because "they can already see the app" — assumes
       * the worker is looking at the screen the notification is about. A rest ending while
       * someone is on the Weather tab is exactly the case this exists for.
       *
       * `shouldShowAlert` is the deprecated spelling of these two; both are set because the
       * banner is the signal and the list entry is what lets someone find it again after
       * the banner has gone.
       */
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      /* Respects the phone's silent and Do Not Disturb settings, as decided. Overriding
         those on iOS needs Apple's Critical Alerts entitlement, which is a separate
         application to Apple and needs a development build. */
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === "android") {
    try {
      await setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "CrewSafe alerts",
        // HIGH, not DEFAULT: DEFAULT puts the notification in the tray without a heads-up,
        // which for a rest that has just ended means the worker finds out when they next
        // unlock the phone rather than when it happens.
        importance: AndroidImportance.HIGH,
        vibrationPattern: ANDROID_VIBRATION_PATTERN,
        enableVibrate: true,
        sound: "default",
      });
    } catch {
      // A channel that could not be created costs the vibration pattern and the heads-up,
      // not the notification. Nothing here is worth failing app startup over.
    }
  }
}

/** What the OS currently thinks, without asking the user anything. */
export async function getPermission(): Promise<NotificationPermission> {
  try {
    const { status, canAskAgain } = await getPermissionsAsync();
    if (status === "granted") return "granted";
    // `undetermined` only if the system prompt has never been shown AND can still be shown.
    // On iOS a refusal makes `canAskAgain` false permanently, and reporting that as
    // "undetermined" would have the app queue up a prompt the OS will never display.
    if (status === "undetermined" && canAskAgain) return "undetermined";
    return "denied";
  } catch {
    return "denied";
  }
}

/**
 * Show the system prompt, once.
 *
 * ── CALL THIS IN CONTEXT, NEVER AT LAUNCH ───────────────────────────────────────────────
 * iOS shows its authorisation prompt exactly once per install. A refusal cannot be re-asked
 * from inside the app at all — only from the OS settings screen — so this has one attempt,
 * and it should be spent at a moment the user already understands what they are being
 * offered. `useNotificationPermission` owns that timing; nothing should call this directly.
 *
 * Returns whether notifications may now be sent, not whether the prompt was shown.
 */
export async function requestPermission(): Promise<boolean> {
  try {
    const { status } = await requestPermissionsAsync({
      // iOS-only, and all three are the ordinary presentation options rather than anything
      // escalated. No `allowCriticalAlerts` — that needs an Apple entitlement this app does
      // not have, and asking for one it lacks makes the whole request fail rather than
      // degrade.
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return status === "granted";
  } catch {
    return false;
  }
}

interface ScheduleRequest {
  title: string;
  body: string;
  /** Epoch ms. A time already past is refused rather than fired immediately — see below. */
  at: number;
  /** Round-tripped to the tap handler, so a notification can open the thing it is about. */
  data?: Record<string, unknown>;
}

/**
 * Hand a notification to the OS to deliver later.
 *
 * The whole point of scheduling rather than firing from a timer: a JS timer only runs while
 * the app is alive, and a worker resting for ten minutes has almost certainly pocketed the
 * phone. The OS holds this one and delivers it whether or not the app survived.
 *
 * Returns the OS identifier the caller must keep in order to cancel it, or null if nothing
 * was scheduled. A null is a normal outcome, not an error: permission may be refused, or the
 * deadline may already have passed.
 */
export async function scheduleAt({ title, body, at, data }: ScheduleRequest): Promise<
  string | null
> {
  /*
   * A deadline in the past is dropped rather than delivered.
   *
   * expo-notifications fires a past DATE trigger immediately, which sounds harmless and is
   * not: the one way to reach this branch is a rest whose deadline expired while the app was
   * closed, and buzzing "your rest is over" ten minutes after the worker went back to work
   * tells them something they already know, at a moment that implies it just happened.
   */
  if (at <= Date.now()) return null;

  if ((await getPermission()) !== "granted") return null;

  try {
    return await scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: data ?? {},
        // Android reads the channel from the content; iOS ignores this field entirely.
        ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: new Date(at),
        ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
    });
  } catch {
    return null;
  }
}

/**
 * Show a notification now.
 *
 * Used where the app has just learned something rather than known it in advance — a poll
 * discovering a drafted plan. Scheduled with a null trigger rather than presented directly,
 * because that is the path that routes through the channel and therefore vibrates.
 */
export async function presentNow(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<boolean> {
  if ((await getPermission()) !== "granted") return false;

  try {
    await scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: data ?? {},
        ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Withdraw a notification that has not fired yet.
 *
 * ── THE FUNCTION THIS MODULE EXISTS TO GET RIGHT ────────────────────────────────────────
 * A scheduled notification outlives whatever scheduled it. If a rest is called off, the card
 * swiped away, or the worker signs out, the pending notification is still sitting in the OS
 * with the app's name on it — and it will buzz "your rest is over" for a rest that never
 * happened. That is worse than no notification at all, because it is a safety app telling
 * someone a falsehood about their own break.
 *
 * Deliberately forgiving about an unknown id: the id may already have fired, or been cleared
 * by the OS, and a caller cancelling defensively is doing the right thing.
 */
export async function cancelScheduled(identifier: string): Promise<void> {
  try {
    await cancelScheduledNotificationAsync(identifier);
  } catch {
    // Already gone. Nothing to do, and nothing worth telling anyone about.
  }
}

/**
 * Cancel every pending notification tagged with a given key.
 *
 * ── WHY MATCH ON DATA RATHER THAN KEEP A TABLE OF IDENTIFIERS ───────────────────────────
 * The obvious design is to store the identifier `scheduleAt` returned and cancel by it later.
 * That needs the table to be persisted — a rest scheduled before the app was killed still has
 * to be cancellable after it restarts — and a persisted table is a second source of truth
 * that can disagree with the OS. It goes stale in both directions: an entry for a
 * notification the OS already delivered, and, far worse, a notification still sitting in the
 * OS with no entry left to cancel it by.
 *
 * The OS already holds the list, so it is asked instead. One scan of a handful of pending
 * notifications costs nothing measurable and cannot drift from the thing it describes.
 */
export async function cancelScheduledFor(key: string, value: string): Promise<void> {
  try {
    const scheduled = await getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((item) => item.content.data?.[key] === value)
        .map((item) => cancelScheduledNotificationAsync(item.identifier)),
    );
  } catch {
    // Nothing readable to cancel. The alternative — throwing — would turn a tidy-up into a
    // failed acknowledgement on the screen that triggered it.
  }
}

/** Every pending notification this app has scheduled. Used on sign-out. */
export async function cancelAllScheduled(): Promise<void> {
  try {
    await cancelAllScheduledNotificationsAsync();
  } catch {
    // As above.
  }
}

/** What a tapped notification carries back, once. */
export interface NotificationTap {
  data: Record<string, unknown>;
}

/**
 * Subscribe to notification taps, and catch the one that launched the app.
 *
 * ── WHY THE LAUNCH CASE NEEDS SEPARATE HANDLING ─────────────────────────────────────────
 * Tapping a notification while the app is running fires the listener. Tapping one that starts
 * the app from cold does not — the tap happened before any JavaScript was running to hear it,
 * and expo-notifications keeps it in `getLastNotificationResponseAsync` instead. Subscribing
 * without also asking for that one produces a feature that works in testing, where the app is
 * always already open, and does nothing for the case it was built for.
 *
 * Returns an unsubscribe function.
 */
export function onNotificationTapped(handler: (tap: NotificationTap) => void): () => void {
  let active = true;

  void getLastNotificationResponseAsync()
    .then((response) => {
      if (!active || !response) return;
      handler({ data: response.notification.request.content.data ?? {} });
    })
    .catch(() => {
      // No launch notification, or none readable. Nothing to route to.
    });

  const subscription = addNotificationResponseReceivedListener((response) => {
    handler({ data: response.notification.request.content.data ?? {} });
  });

  return () => {
    active = false;
    subscription.remove();
  };
}
