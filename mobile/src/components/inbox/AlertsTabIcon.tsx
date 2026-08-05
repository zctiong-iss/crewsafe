/**
 * The Alerts tab icon, with an "all caught up" state (SCRUM-208).
 *
 * Ionicons has no checked-bell glyph, so the tick is composed over the bell rather than
 * swapped in. Composition is the better answer here anyway: the bell stays exactly the bell
 * used on every other state, so the icon does not appear to change *shape* when the worker
 * finishes — only to gain a mark. A different glyph would read as a different thing.
 *
 * The tick is drawn in the success colour rather than the tab's own tint, because it is
 * saying something the tab tint cannot: the tint tells you which tab is selected, the tick
 * tells you the work is done. Those must not be the same signal.
 *
 * Nothing here carries the count — that is the navigator's `tabBarBadge`, with the number
 * also stated in `tabBarAccessibilityLabel`. See `WorkerTabs`.
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { Ionicons } from "@expo/vector-icons";

import { useTheme } from "@/theme/ThemeProvider";

interface AlertsTabIconProps {
  color: string;
  size: number;
  /** True only when something is on screen and all of it is acknowledged. */
  allAcknowledged: boolean;
}

const AlertsTabIcon: FC<AlertsTabIconProps> = ({ color, size, allAcknowledged }) => {
  const theme = useTheme();

  return (
    // `accessible={false}` so the tick does not become a second stop for a screen reader
    // walking the tab bar. The tab itself already announces the state in words.
    <View style={styles.container} accessible={false}>
      <Ionicons testID="alerts-tab-bell" name="notifications" size={size} color={color} />

      {allAcknowledged ? (
        <Ionicons
          testID="alerts-tab-tick"
          name="checkmark-circle"
          size={size * 0.6}
          color={theme.colors.success}
          /*
           * Bordered in the background colour so the tick stays legible where it overlaps
           * the bell. Without it the two glyphs merge into a shape that is neither, which is
           * exactly the kind of detail that survives review and fails in sunlight.
           */
          style={[styles.tick, { backgroundColor: theme.colors.background }]}
        />
      ) : null}
    </View>
  );
};

export default AlertsTabIcon;

const styles = StyleSheet.create({
  container: {
    // The tick is positioned against this, so it must not clip.
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
    right: -4,
    bottom: -2,
    borderRadius: 999,
  },
});
