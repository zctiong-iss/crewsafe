/**
 * Swipe an acknowledged card away (SCRUM-207).
 *
 * ── ONLY WHEN ACKNOWLEDGED ─────────────────────────────────────────────────────────────
 * `enabled` is false for a pending card, one mid-request, and one whose acknowledgement
 * failed. A pending action is an instruction the worker still owes and the supervisor has
 * not been told about; letting it be flicked away would make the inbox lie about what is
 * outstanding. A failed one is worse — the retry button lives on that card, so dismissing it
 * would remove the only route back.
 *
 * The swipe is a shortcut, never the only route. Every acknowledged card clears itself at its
 * deadline whether or not the gesture is ever discovered, which is what keeps this honest for
 * a worker who never finds it.
 *
 * ── WHY THE LEGACY `Swipeable` ─────────────────────────────────────────────────────────
 * `react-native-gesture-handler` 2.32 is already a dependency and `GestureHandlerRootView` is
 * already mounted at the app root. `ReanimatedSwipeable` would pull in
 * `react-native-reanimated`, which is *not* installed — a native dependency on a project that
 * has never produced an EAS build. The legacy component runs on RN `Animated`, the same
 * driver `AnimatedIcon` and the rest progress bar already use.
 */
import { useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import type { FC, ReactNode } from "react";
import { Swipeable } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

interface SwipeToDismissProps {
  enabled: boolean;
  onDismiss: () => void;
  children: ReactNode;
}

/**
 * How far the card must travel before releasing it dismisses.
 *
 * Generous on purpose. The alternative failure — a worker brushing the list while scrolling
 * and losing a card — is worse than having to swipe a little further, and this screen is used
 * in gloves.
 */
const THRESHOLD = 96;

const SwipeToDismiss: FC<SwipeToDismissProps> = ({ enabled, onDismiss, children }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const ref = useRef<Swipeable>(null);

  if (!enabled) return <>{children}</>;

  /*
   * The panel revealed behind the card.
   *
   * It fades and scales in with the drag rather than appearing at full strength, so a partial
   * swipe reads as "keep going" instead of "this has already happened". Without any reveal at
   * all the gesture is undiscoverable and a half-swipe gives no feedback — which on a gloved
   * hand is most swipes.
   *
   * `dragX` is interpolated in both directions because the gesture is accepted either way: a
   * worker should not have to remember which.
   */
  const renderAction = (dragX: Animated.AnimatedInterpolation<number>, side: "left" | "right") => {
    const input = side === "left" ? [0, THRESHOLD] : [-THRESHOLD, 0];
    const output = side === "left" ? [0, 1] : [1, 0];

    const opacity = dragX.interpolate({
      inputRange: input,
      outputRange: output,
      extrapolate: "clamp",
    });

    return (
      <Animated.View
        style={[
          styles.action,
          side === "left" ? styles.actionLeft : styles.actionRight,
          { backgroundColor: theme.colors.success, opacity, borderRadius: theme.metrics.radius },
        ]}
      >
        <Ionicons name="checkmark-done" size={s(22)} color={theme.colors.textInverse} />
        <AppText variant="label" style={[styles.actionLabel, { color: theme.colors.textInverse }]}>
          {t("inbox.swipeToClear")}
        </AppText>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={ref}
      friction={2}
      leftThreshold={THRESHOLD}
      rightThreshold={THRESHOLD}
      renderLeftActions={(_progress, dragX) => renderAction(dragX, "left")}
      renderRightActions={(_progress, dragX) => renderAction(dragX, "right")}
      onSwipeableOpen={() => {
        /*
         * Dismiss on open rather than animating the card off screen first.
         *
         * The row is removed from the list by a store update, so the card unmounts anyway —
         * playing a close animation into an unmount is a race that leaves the panel visible
         * for a frame on a fast list update.
         */
        onDismiss();
      }}
      // Vertical scrolling must keep working with a swipe half-open. Without this the list
      // and the row fight over the gesture, which is the known failure mode of a Swipeable
      // inside a FlatList.
      overshootLeft={false}
      overshootRight={false}
    >
      <View>{children}</View>
    </Swipeable>
  );
};

export default SwipeToDismiss;

const styles = StyleSheet.create({
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: s(20),
    // Matches DispatchCard's own bottom margin, so the revealed panel lines up with the card
    // instead of bleeding into the gap below it.
    marginBottom: vs(12),
  },
  actionLeft: {
    justifyContent: "flex-start",
  },
  actionRight: {
    justifyContent: "flex-end",
  },
  actionLabel: {
    marginStart: s(8),
  },
});
