/**
 * The app's transient confirmation, rendered once at the root.
 *
 * Sits above the navigator rather than inside a screen so it survives the navigation that
 * usually triggers it — deleting a shift pops back to the list, and a toast owned by the
 * detail screen would unmount before it could be read.
 *
 * @author Justin Chua
 */
import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { hideToast, type ToastTone } from "@/store/reducers/uiSlice";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";

/** Long enough to read a short sentence in a second language, short enough not to nag. */
const VISIBLE_MS = 3500;

const ICONS: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  success: "checkmark-circle",
  danger: "alert-circle",
  info: "information-circle",
};

const NATIVE_DRIVER = Platform.OS !== "web";

export default function Toast() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const reduceMotion = useReduceMotion();

  const { messageKey, tone, nonce } = useAppSelector((state) => state.ui);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!messageKey) return;

    // `nonce` is in the deps so an identical repeat message restarts the animation and the
    // timer rather than appearing to do nothing.
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : 180,
      useNativeDriver: NATIVE_DRIVER,
    }).start();

    const timer = setTimeout(() => dispatch(hideToast()), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [messageKey, nonce, dispatch, progress, reduceMotion]);

  if (!messageKey) return null;

  const accent =
    tone === "success"
      ? theme.colors.success
      : tone === "danger"
        ? theme.colors.danger
        : theme.colors.textPrimary;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          // Clears the tab bar and the home indicator. A toast under either is a toast
          // nobody reads.
          bottom: insets.bottom + vs(70),
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                // No travel when motion is reduced — it fades in place instead.
                outputRange: [reduceMotion ? 0 : vs(16), 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable
        // Dismissible, because 3.5 seconds is a guess and someone who has read it should
        // not have to wait out the rest.
        onPress={() => dispatch(hideToast())}
        accessibilityRole="alert"
        accessibilityLabel={t(messageKey)}
        style={[
          styles.toast,
          {
            backgroundColor: theme.colors.surface,
            borderColor: accent,
            borderWidth: theme.metrics.borderWidth + 1,
            borderRadius: theme.metrics.radius,
          },
        ]}
      >
        <Ionicons name={ICONS[tone]} size={s(20)} color={accent} style={styles.icon} />
        {/* flex:1 so a long translated message wraps inside the toast rather than
            stretching it past the screen. */}
        <AppText variant="label" style={styles.message}>
          {t(messageKey)}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: s(16),
    right: s(16),
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: s(14),
    paddingVertical: vs(12),
    // Kept above the tab bar on Android, which ignores stacking order without it.
    elevation: 6,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },
  icon: {
    marginEnd: s(10),
  },
  message: {
    flex: 1,
  },
});
