/**
 * Shared bottom-tab styling for both role tab sets.
 *
 * Two things here are deliberate and easy to get wrong:
 *
 * 1. No explicit `height`. React Navigation sizes the tab bar from the bottom safe-area
 *    inset itself; overriding the height replaces that calculation rather than adding to
 *    it, which pushes the labels under the home indicator on a gesture-navigation phone.
 *    Padding and font size are safe to set — height is not.
 *
 * 2. The label font scale is capped well below the app's own maximum. Tab labels sit in a
 *    fixed-width column with no room to wrap, so they clip rather than reflow. The setting
 *    is honoured where it matters — screen content — and damped in the chrome, which is
 *    the standard resolution for this conflict.
 */
import { s, vs } from "react-native-size-matters";
import type { BottomTabNavigationOptions } from "@react-navigation/bottom-tabs";
import { AppFonts } from "@/styles/fonts";
import type { AppTheme } from "@/styles/theme";

/** Beyond this, a tab label clips instead of growing. */
const MAX_TAB_LABEL_SCALE = 1.15;

export function tabScreenOptions(theme: AppTheme): BottomTabNavigationOptions {
  return {
    headerShown: false,
    tabBarActiveTintColor: theme.colors.primary,
    tabBarInactiveTintColor: theme.colors.textSecondary,
    // Matches AppText, which opts out of OS scaling in favour of the in-app setting.
    // Without this the labels would scale on the OS setting while nothing else did.
    tabBarAllowFontScaling: false,
    tabBarStyle: {
      backgroundColor: theme.colors.surface,
      borderTopColor: theme.colors.border,
      borderTopWidth: theme.metrics.borderWidth,
      paddingTop: vs(4),
    },
    tabBarLabelStyle: {
      fontFamily: AppFonts.medium,
      fontSize: s(11) * Math.min(theme.fontScale, MAX_TAB_LABEL_SCALE),
    },
  };
}
