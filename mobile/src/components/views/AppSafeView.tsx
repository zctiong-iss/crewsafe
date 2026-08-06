/**
 * The screen container. Handles the notch, the keyboard, and nothing it should not.
 *
 * The subtlety here is that React Navigation already consumes safe-area insets on a
 * screen's behalf: a stack header sits under the status bar and absorbs the top inset, and
 * a bottom tab bar absorbs the bottom one. A container that unconditionally re-applies
 * both — which is the obvious way to write this — double-pads every screen inside a tab,
 * leaving a visible dead band under the header and above the tab bar.
 *
 * So insets are opt-in per edge, and the default is the pair no navigator ever handles:
 * left and right, which only matter in landscape on a notched device. A screen rendered
 * with `headerShown: false` (the sign-in screen) asks for `top` explicitly.
 *
 * Uses `SafeAreaView` from `react-native-safe-area-context`, not React Native's, which is
 * iOS-only and would fall back to `StatusBar.currentHeight` on Android — missing gesture
 * bars and punch-hole cutouts.
 *
 * @author Justin Chua
 */
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import type { FC, ReactNode } from "react";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Horizontal only. Vertical insets belong to whichever navigator is above this screen;
 * a screen that genuinely owns its own top or bottom edge passes them in.
 */
const DEFAULT_EDGES: readonly Edge[] = ["left", "right"];

interface AppSafeViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Set false when the screen owns its own scroll container and handles the keyboard. */
  avoidKeyboard?: boolean;
  /**
   * Which edges to pad. Add `"top"` for a screen with no header, `"bottom"` for one
   * outside the tab navigator.
   */
  edges?: readonly Edge[];
}

const AppSafeView: FC<AppSafeViewProps> = ({
  children,
  style,
  avoidKeyboard = true,
  edges = DEFAULT_EDGES,
}) => {
  const theme = useTheme();

  const content = (
    <SafeAreaView
      edges={edges}
      style={[styles.container, { backgroundColor: theme.colors.background }, style]}
    >
      {children}
    </SafeAreaView>
  );

  if (!avoidKeyboard) return content;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // "padding" is correct on iOS. On Android the system already resizes the window
      // (adjustResize), so adding padding on top double-counts and pushes content off the
      // screen — which is why this is undefined rather than "height" there.
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {content}
    </KeyboardAvoidingView>
  );
};

export default AppSafeView;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
});
