import { StyleSheet, Switch, TouchableOpacity, View } from "react-native";
import type { FC } from "react";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

interface AppSwitchProps {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/**
 * A labelled toggle. Used for the accessibility settings and the dev panels.
 *
 * The whole row is tappable, not just the switch: a 50pt switch is a small target for a
 * gloved hand, and the label is the part people actually aim at. The `Switch` keeps its own
 * `onValueChange` so a drag gesture still works — tapping the row and dragging the thumb
 * both have to do the right thing.
 */
const AppSwitch: FC<AppSwitchProps> = ({ label, hint, value, onValueChange, disabled = false }) => {
  const theme = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      style={[styles.row, { minHeight: theme.metrics.minTouchTarget }]}
    >
      {/* flex:1 so a long translated label wraps instead of shoving the switch off-screen. */}
      <View style={styles.labels}>
        <AppText variant="body" tone={disabled ? "secondary" : "primary"}>
          {label}
        </AppText>
        {hint ? (
          <AppText variant="caption" tone="secondary" style={styles.hint}>
            {hint}
          </AppText>
        ) : null}
      </View>

      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        // The row already announces itself; the inner control would repeat it.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        trackColor={{ false: theme.colors.disabled, true: theme.colors.primary }}
        thumbColor={theme.colors.surface}
        ios_backgroundColor={theme.colors.disabled}
      />
    </TouchableOpacity>
  );
};

export default AppSwitch;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: vs(8),
  },
  labels: {
    flex: 1,
    marginEnd: s(12),
  },
  hint: {
    marginTop: vs(2),
  },
});
