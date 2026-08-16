/**
 * A date-and-time field.
 *
 * A shift needs a date *and* a time — a picker that only collects one is how you end up
 * with a shift that starts at midnight because nobody was asked.
 *
 * ── ONE PICKER, BOTH PLATFORMS ──────────────────────────────────────────────────────────
 * This used to wrap `@react-native-community/datetimepicker`, which meant two shapes: Android
 * imperative (`DateTimePickerAndroid.open`, one dialog per mode, so date and time were two
 * chained dialogs) and iOS declarative. `AppCalendarPicker` collects both in one panel on
 * both platforms, so the chaining — and the half-answered state it created when someone
 * dismissed the second dialog — is gone. See that component for why the library was dropped.
 *
 * @author Justin Chua
 */
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { FC } from "react";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import AppCalendarPicker from "./AppCalendarPicker";
import { useTheme } from "@/theme/ThemeProvider";
import { formatDateTime } from "@/helpers/dateTime";

interface AppDateTimeFieldProps {
  label: string;
  value: Date | null;
  onChange: (next: Date) => void;
  /** Already-translated. Rendered below and folded into the accessible label. */
  errorMessage?: string;
  placeholder: string;
  locale: string;
}

const AppDateTimeField: FC<AppDateTimeFieldProps> = ({
  label,
  value,
  onChange,
  errorMessage,
  placeholder,
  locale,
}) => {
  const theme = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasError = Boolean(errorMessage);

  // Opening with "now" rather than an arbitrary epoch: a supervisor planning a shift is
  // almost always working from today.
  const current = value ?? new Date();

  return (
    <View style={styles.wrapper}>
      <AppText variant="label" style={styles.label}>
        {label}
      </AppText>

      <Pressable
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        // The error is read with the field rather than as a separate stop, the same way
        // AppTextInput handles it.
        accessibilityLabel={hasError ? `${label}. ${errorMessage}` : label}
        style={[
          styles.field,
          {
            backgroundColor: theme.colors.surface,
            borderColor: hasError ? theme.colors.danger : theme.colors.border,
            borderWidth: hasError ? theme.metrics.borderWidth + 1 : theme.metrics.borderWidth,
            borderRadius: theme.metrics.radius,
            minHeight: Math.max(theme.metrics.minTouchTarget, vs(44) * theme.fontScale),
          },
        ]}
      >
        {/* flex:1 so a long localised date string wraps rather than pushing the icon out. */}
        <AppText variant="body" tone={value ? "primary" : "secondary"} style={styles.valueText}>
          {value ? formatDateTime(value.toISOString(), locale) : placeholder}
        </AppText>
        <Ionicons name="calendar-outline" size={s(20)} color={theme.colors.textSecondary} />
      </Pressable>

      <AppCalendarPicker
        visible={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(picked) => {
          setPickerOpen(false);
          onChange(picked);
        }}
        initialValue={current}
        mode="datetime"
        locale={locale}
        title={label}
      />

      {hasError ? (
        <AppText variant="caption" tone="danger" style={styles.error}>
          {errorMessage}
        </AppText>
      ) : null}
    </View>
  );
};

export default AppDateTimeField;

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: vs(14),
  },
  label: {
    marginBottom: vs(6),
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(14),
    paddingVertical: vs(10),
  },
  valueText: {
    flex: 1,
    marginEnd: s(10),
  },
  error: {
    marginTop: vs(4),
  },
});
