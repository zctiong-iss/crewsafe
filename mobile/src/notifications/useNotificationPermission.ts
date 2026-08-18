/**
 * Asking for notification permission at a moment the answer means something.
 *
 * ── WHY THIS IS NOT A ONE-LINE CALL AT STARTUP ──────────────────────────────────────────
 * iOS shows its authorisation prompt exactly once per install, and a refusal cannot be
 * re-asked from inside the app at all — only by sending the user to the OS settings screen
 * and hoping they go. So the app gets ONE attempt, and where it spends it decides whether
 * this whole feature ever works.
 *
 * Spending it on cold start is the worst available choice: that is the moment a user has the
 * least idea what CrewSafe is, and a permission dialog arriving before the first screen is
 * the one people dismiss reflexively. Instead it is spent in context — the first time a
 * worker acknowledges a rest they will be timed on, the first time a supervisor opens the
 * plans they would want to hear about — where the sentence "we will tell you when this is
 * done" is self-evidently about the thing they just did.
 *
 * An in-app explanation goes first, so the system prompt is only ever reached by someone who
 * has already said yes to the idea. That extra step is what turns the single attempt from a
 * coin toss into a question with a known answer.
 *
 * ── REFUSAL IS A SUPPORTED STATE, NOT AN ERROR ──────────────────────────────────────────
 * Everything these notifications carry is also shown in the app: the rest timer still counts
 * down and still clears its card, the plan still appears on the Plans tab. That is a
 * requirement rather than a happy accident — a safety app whose worker missed a rest-end
 * signal must not be an app that made that signal notification-only. Callers get a boolean
 * and are expected to carry on regardless of it.
 *
 * @author Justin Chua
 */
import { useCallback } from "react";
import { Alert, Linking } from "react-native";
import { useTranslation } from "react-i18next";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { notificationRationaleShown } from "@/store/reducers/preferencesSlice";
import { getPermission, requestPermission } from "./notificationClient";

interface NotificationPermissionApi {
  /**
   * Make sure notifications can be sent, asking if that is still possible.
   *
   * Resolves true only if a notification sent right now would actually arrive. Safe to call
   * on every acknowledgement — it short-circuits once the question has been settled either
   * way, so it costs a permission read and nothing else on the common path.
   */
  ensure: () => Promise<boolean>;
  /** Whether sending is currently worth attempting, without asking the user anything. */
  isEnabled: () => Promise<boolean>;
  /** Sends the user to the OS settings page for this app. Nothing else can undo a refusal. */
  openSystemSettings: () => void;
}

export function useNotificationPermission(): NotificationPermissionApi {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const muted = useAppSelector((state) => state.preferences.notificationsMuted);
  const rationaleAlreadyShown = useAppSelector(
    (state) => state.preferences.notificationRationaleShown,
  );

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  const isEnabled = useCallback(async () => {
    // Muted beats granted. Someone who turned the switch off in Settings has answered a
    // question the OS was never asked, and the OS saying yes does not overrule them.
    if (muted) return false;
    return (await getPermission()) === "granted";
  }, [muted]);

  const ensure = useCallback(async () => {
    if (muted) return false;

    const status = await getPermission();
    if (status === "granted") return true;

    /*
     * Denied is final from in here.
     *
     * On iOS this covers both an outright refusal and an install where the prompt has been
     * spent; on Android it covers a user who ticked "don't ask again". In every case
     * `requestPermission` would resolve false without showing anything, and calling it
     * anyway would make this function look like it tries each time when it cannot.
     */
    if (status === "denied") return false;

    /*
     * Undetermined, and we have already explained ourselves once.
     *
     * Reached by someone who read the explanation and chose "not now". Asking again on their
     * next acknowledgement is nagging, and on iOS the system prompt behind it may already
     * have been consumed — so this stops here rather than spending an attempt that may not
     * exist on someone who has already declined.
     */
    if (rationaleAlreadyShown) return false;

    // Recorded before the dialog, not after. A user who backgrounds the app mid-dialog has
    // still been asked, and coming back to a second copy of it would be worse than missing
    // the flag.
    dispatch(notificationRationaleShown());

    const accepted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        t("notifications.rationaleTitle"),
        t("notifications.rationaleBody"),
        [
          // "Not now" first, so the destructive-to-the-feature option is not the one a thumb
          // lands on by default. Declining here is free; it costs the notifications, not the
          // action the user was actually taking.
          { text: t("notifications.rationaleDecline"), style: "cancel", onPress: () => resolve(false) },
          { text: t("notifications.rationaleAccept"), onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });

    if (!accepted) return false;

    return requestPermission();
  }, [dispatch, muted, rationaleAlreadyShown, t]);

  return { ensure, isEnabled, openSystemSettings };
}
