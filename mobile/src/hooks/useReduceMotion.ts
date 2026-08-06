/**
 * Whether decorative motion should be suppressed.
 *
 * True if the operating system says so (iOS "Reduce Motion", Android "Remove animations")
 * or if the signed-in user has it on inside CrewSafe. Either is sufficient — this is an
 * accessibility control, and the safe direction is off.
 *
 * The in-app half is per user account, not per device (SCRUM-199): a new worker signing in
 * on a shared site phone gets the default rather than the last worker's answer. See
 * `preferencesSlice` for why this one setting is keyed that way and the others are not.
 *
 * WCAG 2.2 SC 2.2.2 requires any auto-playing animation that loops beyond five seconds to
 * be stoppable. A banner icon that pulses for as long as the banner is on screen is exactly
 * that case, so this hook is not optional polish: without it the animated icons are a
 * conformance failure, and for someone with a vestibular disorder they are worse than that.
 *
 * ── WHY THE TWO SOURCES ARE ALSO READABLE APART ─────────────────────────────────────────
 * `useReduceMotion` is the union and remains what almost everything should call. The split
 * exists for one narrow case (see `AnimatedIcon`'s `essential` prop): since SCRUM-199 the
 * in-app preference defaults to *on*, so a worker who has never opened Settings now has
 * motion suppressed by default. For the stop-work banner that would silently remove a
 * safety cue nobody opted out of.
 *
 * The device setting is never overridable. Someone who set Reduce Motion at the OS level
 * has told their phone something about their body, and no in-app judgement about urgency
 * outranks that — which is exactly the line SC 2.2.2 draws.
 *
 * @author Justin Chua
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useAppSelector } from "@/store/hooks";
import { selectReduceMotionFor } from "@/store/reducers/preferencesSlice";

/**
 * The OS-level setting alone. Cannot be overridden by anything in the app.
 */
export function useSystemReduceMotion(): boolean {
  const [systemSetting, setSystemSetting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // The initial read is async and the listener only fires on *changes*, so both are
    // needed — a device that already has the setting on would otherwise animate until the
    // user toggled it twice.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setSystemSetting(enabled);
      })
      .catch(() => {
        // Unsupported platform. Falls back to the in-app preference alone.
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setSystemSetting,
    );

    return () => {
      cancelled = true;
      // Optional call: react-native-web's AccessibilityInfo does not implement every event,
      // and a throw inside a cleanup function aborts unmounting the whole subtree.
      subscription?.remove?.();
    };
  }, []);

  return systemSetting;
}

/**
 * The signed-in user's own in-app preference, or the default while nobody is resolved.
 *
 * Exported for the Settings screen, which needs the preference on its own to decide whether
 * the switch is showing a choice or being forced by the device.
 */
export function useReduceMotionPreference(): boolean {
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const byUser = useAppSelector((state) => state.preferences.reduceMotionByUser);

  return selectReduceMotionFor(byUser, userId);
}

export function useReduceMotion(): boolean {
  const preference = useReduceMotionPreference();
  const systemSetting = useSystemReduceMotion();

  return systemSetting || preference;
}
