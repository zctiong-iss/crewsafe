import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { FC, ReactNode } from "react";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

export type AppButtonVariant = "primary" | "secondary" | "danger";

interface AppButtonProps {
  onPress: () => void;
  title: string;
  variant?: AppButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and blocks presses. Keeps the label, so the button does not resize. */
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  styleTitle?: StyleProp<TextStyle>;
  accessibilityHint?: string;
}

const AppButton: FC<AppButtonProps> = ({
  onPress,
  title,
  variant = "primary",
  disabled = false,
  loading = false,
  icon,
  style,
  styleTitle,
  accessibilityHint,
}) => {
  const theme = useTheme();
  const isInactive = disabled || loading;

  const palette: Record<AppButtonVariant, { background: string; border: string; text: string }> = {
    primary: {
      background: theme.colors.primary,
      border: theme.colors.primary,
      text: theme.colors.onPrimary,
    },
    secondary: {
      background: theme.colors.surface,
      border: theme.colors.borderStrong,
      text: theme.colors.textPrimary,
    },
    danger: {
      background: theme.colors.danger,
      border: theme.colors.danger,
      text: theme.colors.textInverse,
    },
  };

  const active = palette[variant];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: isInactive, busy: loading }}
      accessibilityHint={accessibilityHint}
      style={[
        styles.button,
        {
          backgroundColor: isInactive ? theme.colors.disabled : active.background,
          borderColor: isInactive ? theme.colors.disabled : active.border,
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius,
          // Grows with the text setting, so a large-text user does not get a clipped label.
          minHeight: Math.max(theme.metrics.minTouchTarget, vs(44) * theme.fontScale),
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={isInactive ? theme.colors.onDisabled : active.text}
            style={styles.spinner}
          />
        ) : (
          icon && <View style={styles.icon}>{icon}</View>
        )}
        {/*
          The shrinking happens on this View, never on the Text.

          A `Text` that is itself the flex-shrinking node does not wrap when the row runs out
          of room on Android — it *clips*, at a word boundary, with no ellipsis to show that
          anything was lost. A `View` shrinks correctly, and a Text with no flex properties
          of its own simply wraps inside whatever width its parent ended up with. Same
          layout, deterministic outcome.
        */}
        <View style={styles.titleWrap}>
          <AppText
            variant="label"
            style={[
              styles.title,
              { color: isInactive ? theme.colors.onDisabled : active.text },
              styleTitle,
            ]}
          >
            {title}
          </AppText>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default AppButton;

const styles = StyleSheet.create({
  button: {
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    paddingHorizontal: s(16),
    paddingVertical: vs(10),
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    /*
     * A definite width, not `flexShrink: 1`.
     *
     * The row previously sized to its own content and shrank. That kept long labels inside
     * the button — the original problem, and Hindi and Simplified Chinese really are much
     * longer than the English they were laid out against ("खाते का अनुरोध करें" for "Request
     * an account") — but it made the width available to the label depend on when the row
     * happened to be measured.
     *
     * Inside a virtualised FlatList that is not stable. The first cell lays out with the
     * real width; later cells are measured during virtualisation against a narrower
     * estimate, and a `Text` that is itself shrinkable resolves that by *clipping at a word
     * boundary* rather than wrapping. The Malay inbox showed it plainly: "Akui terima" on
     * the first card, "Akui" on every card below it, with no ellipsis to hint that anything
     * had been cut.
     *
     * English never triggered it. "Acknowledge" is one word with nowhere to break, so the
     * bug needed a two-word label to become visible — it has been latent since the button
     * was written.
     *
     * `width: "100%"` makes the available width the button's content box, which is known
     * before the label is measured and identical in every cell. The label wraps instead of
     * clipping, and `minHeight` (rather than `height`) lets the button grow to fit it.
     */
    width: "100%",
  },
  titleWrap: {
    // The only shrinking node in the button. See the note at the call site for why this is
    // a View and not the Text itself.
    flexShrink: 1,
  },
  title: {
    textAlign: "center",
    // Deliberately no flex properties. Giving the Text `flexShrink` is what caused it to
    // clip mid-label instead of wrapping; it now inherits a settled width from `titleWrap`
    // and wraps inside it.
  },
  icon: {
    marginEnd: s(8),
  },
  spinner: {
    marginEnd: s(8),
  },
});
