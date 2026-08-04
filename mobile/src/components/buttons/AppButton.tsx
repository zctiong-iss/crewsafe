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
    // Without this the row keeps its intrinsic width and the label runs past the button's
    // rounded edge. Hindi and Simplified Chinese labels are materially longer than the
    // English ones they were laid out against — "खाते का अनुरोध करें" for "Request an
    // account" — so this is load-bearing, not defensive.
    flexShrink: 1,
  },
  title: {
    textAlign: "center",
    // Lets the text wrap inside the button instead of overflowing it. The button uses
    // minHeight rather than height precisely so a wrapped label can grow the button.
    flexShrink: 1,
  },
  icon: {
    marginEnd: s(8),
  },
  spinner: {
    marginEnd: s(8),
  },
});
