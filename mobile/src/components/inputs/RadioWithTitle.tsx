/**
 * A single radio option with a title, an optional subtitle, and a disabled state.
 *
 * @author Justin Chua
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import type { FC } from "react";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

interface RadioWithTitleProps {
  title: string;
  /** Optional second line — role, language name in its own script, and so on. */
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/**
 * A radio row. Used for language choice, text size and the demo-user picker.
 *
 * The whole row is the target, not just the circle: a 20pt circle is under half the
 * recommended minimum and unusable in gloves, which is the operating condition this app is
 * designed for.
 */
const RadioWithTitle: FC<RadioWithTitleProps> = ({
  title,
  subtitle,
  selected,
  onPress,
  disabled = false,
}) => {
  const theme = useTheme();
  const outer = s(22);
  const inner = s(11);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={[styles.container, { minHeight: theme.metrics.minTouchTarget }]}
    >
      <View
        style={[
          styles.circle,
          {
            width: outer,
            height: outer,
            borderRadius: outer / 2,
            borderWidth: theme.metrics.borderWidth + 1,
            borderColor: disabled ? theme.colors.disabled : theme.colors.borderStrong,
          },
        ]}
      >
        {selected ? (
          <View
            style={{
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              backgroundColor: disabled ? theme.colors.disabled : theme.colors.primary,
            }}
          />
        ) : null}
      </View>

      {/* flexShrink lets a long label wrap inside the row rather than pushing past its
          edge — the Hindi and Chinese labels are materially longer than the English. */}
      <View style={styles.labels}>
        <AppText variant="body" tone={disabled ? "secondary" : "primary"}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="secondary" style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

export default RadioWithTitle;

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: vs(8),
  },
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
  labels: {
    flex: 1,
    marginStart: s(12),
  },
  subtitle: {
    marginTop: vs(2),
  },
});
