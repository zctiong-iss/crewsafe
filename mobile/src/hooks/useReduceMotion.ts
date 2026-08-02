/**
 * Whether decorative motion should be suppressed.
 *
 * True if the operating system says so (iOS "Reduce Motion", Android "Remove animations")
 * or if the user has turned it off inside CrewSafe. Either is sufficient — this is an
 * accessibility control, and the safe direction is off.
 *
 * WCAG 2.2 SC 2.2.2 requires any auto-playing animation that loops beyond five seconds to
 * be stoppable. A banner icon that pulses for as long as the banner is on screen is exactly
 * that case, so this hook is not optional polish: without it the animated icons are a
 * conformance failure, and for someone with a vestibular disorder they are worse than that.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useAppSelector } from "@/store/hooks";

export function useReduceMotion(): boolean {
  const preference = useAppSelector((state) => state.preferences.reduceMotion);
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

  return systemSetting || preference;
}
