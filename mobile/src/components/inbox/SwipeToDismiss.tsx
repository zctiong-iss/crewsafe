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
 * ── SUPPORTED SWIPE IMPLEMENTATION ──────────────────────────────────────────────────────
 * `ReanimatedSwipeable` is the supported gesture-handler API. Its Expo-compatible Reanimated
 * dependencies keep the action reveal on the UI-thread animation boundary while the store
 * callback still runs only after the swipe has opened.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC, ReactNode } from "react";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, Extrapolation, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
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

const SwipeAction: FC<Readonly<{ translation: SharedValue<number>; side: "left" | "right"; backgroundColor: string; textColor: string; label: string; radius: number }>> = ({ translation, side, backgroundColor, textColor, label, radius }) => {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translation.value, side === "left" ? [0, THRESHOLD] : [-THRESHOLD, 0], side === "left" ? [0, 1] : [1, 0], Extrapolation.CLAMP),
  }));
  return <Animated.View style={[styles.action, side === "left" ? styles.actionLeft : styles.actionRight, animatedStyle, { backgroundColor, borderRadius: radius }]}>
    <Ionicons name="checkmark-done" size={s(22)} color={textColor} />
    <AppText variant="label" style={[styles.actionLabel, { color: textColor }]}>{label}</AppText>
  </Animated.View>;
};

const SwipeToDismiss: FC<Readonly<SwipeToDismissProps>> = ({ enabled, onDismiss, children }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  if (!enabled) return <>{children}</>;

  /*
   * The panel revealed behind the card.
   *
   * It fades and scales in with the drag rather than appearing at full strength, so a partial
   * swipe reads as "keep going" instead of "this has already happened". Without any reveal at
   * all the gesture is undiscoverable and a half-swipe gives no feedback — which on a gloved
   * hand is most swipes.
   *
   * `translation` is interpolated in both directions because the gesture is accepted either way: a
   * worker should not have to remember which.
   */
  return (
    <ReanimatedSwipeable
      friction={2}
      leftThreshold={THRESHOLD}
      rightThreshold={THRESHOLD}
      renderLeftActions={(_progress, translation) => <SwipeAction translation={translation} side="left" backgroundColor={theme.colors.success} textColor={theme.colors.textInverse} label={t("inbox.swipeToClear")} radius={theme.metrics.radius} />}
      renderRightActions={(_progress, translation) => <SwipeAction translation={translation} side="right" backgroundColor={theme.colors.success} textColor={theme.colors.textInverse} label={t("inbox.swipeToClear")} radius={theme.metrics.radius} />}
      onSwipeableOpen={(_direction) => {
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
    </ReanimatedSwipeable>
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
