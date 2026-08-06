/**
 * A bottom sheet built on React Native's own `Modal`.
 *
 * ── WHY NOT `react-native-actions-sheet` ────────────────────────────────────────────────
 * It was used here originally and had to go. Version 10.1.2 — the latest — declares
 * `react-native-worklets: ^0.7.1`, while Expo SDK 57 ships worklets 0.10 natively. Inside
 * Expo Go the native `libworklets.so` is fixed at whatever Expo Go was built with, so the
 * library's JS talks to an ABI it was not written against and the process dies with a
 * SIGSEGV inside libworklets on the JS thread, before anything renders.
 *
 * That is not fixable from here: no npm `overrides` arrangement reconciles a JS/native ABI
 * gap, and pinning it back to 0.7.x only moves which side is wrong. The library needs a
 * release that targets worklets 0.10.
 *
 * `Modal` costs nothing by comparison. It is part of React Native, needs no native module,
 * and removing the dependency also removed `react-native-reanimated` and
 * `react-native-worklets` — which were in the tree *only* to satisfy it, since every
 * animation in this app uses the built-in `Animated` API.
 *
 * ── VISIBILITY IS A PROP, NOT A GLOBAL REGISTRY ─────────────────────────────────────────
 * The old library opened sheets by id through a global `SheetManager`. This takes `visible`
 * and `onClose` instead, so a sheet is owned by the screen that shows it. That is more
 * ordinary React, it type-checks without module augmentation, and it removes the failure
 * mode where a missing side-effect import made `show()` silently do nothing.
 *
 * @author Justin Chua
 */
import { Modal, Pressable, StyleSheet, View } from "react-native";
import type { FC, ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Already-translated. Announced as the sheet's heading. */
  title: string;
  children: ReactNode;
}

const BottomSheet: FC<BottomSheetProps> = ({ visible, onClose, title, children }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  return (
    <Modal
      visible={visible}
      transparent
      // The slide is RN's own, so there is no animation library involved. Suppressed
      // entirely when the user has asked for reduced motion.
      animationType={reduceMotion ? "none" : "slide"}
      // Android's hardware back must dismiss the sheet, not the screen behind it.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Tapping outside closes. A plain Pressable rather than a gesture handler: this is
            a tap, and pulling in a gesture library for it would reintroduce exactly the kind
            of native dependency this component exists to avoid. */}
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={title}
        />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.metrics.radius * 2,
              borderTopRightRadius: theme.metrics.radius * 2,
              borderColor: theme.colors.border,
              borderWidth: theme.metrics.borderWidth,
              // A Modal renders above the safe-area padding a screen would normally get,
              // so the home indicator has to be cleared here by hand.
              paddingBottom: Math.max(insets.bottom, vs(12)) + vs(12),
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: theme.colors.border }]} />

          <AppText variant="subtitle" style={styles.title}>
            {title}
          </AppText>

          {children}
        </View>
      </View>
    </Modal>
  );
};

export default BottomSheet;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    // Written out rather than `StyleSheet.absoluteFillObject`, which RN 0.86 no longer
    // exposes on the StyleSheet type.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    width: "100%",
    paddingHorizontal: s(16),
    paddingTop: vs(10),
  },
  grabber: {
    width: s(40),
    height: vs(4),
    borderRadius: vs(2),
    alignSelf: "center",
    marginBottom: vs(12),
  },
  title: {
    marginBottom: vs(12),
  },
});
