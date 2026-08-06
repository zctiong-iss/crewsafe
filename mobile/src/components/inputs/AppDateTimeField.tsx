/**
 * A date-and-time field.
 *
 * The two platforms want opposite shapes and the library reflects that: Android is
 * imperative (`DateTimePickerAndroid.open`, one dialog per component, so date and time are
 * two dialogs chained), iOS is declarative (render the picker, it appears inline). Wrapping
 * both here means the form never has to know.
 *
 * A shift needs a date *and* a time — a picker that only collects one is how you end up
 * with a shift that starts at midnight because nobody was asked.
 *
 * @author Justin Chua
 */
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { FC } from "react";
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
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
  const [iosPickerOpen, setIosPickerOpen] = useState(false);
  const hasError = Boolean(errorMessage);

  // Opening with "now" rather than an arbitrary epoch: a supervisor planning a shift is
  // almost always working from today.
  const current = value ?? new Date();

  const openAndroid = () => {
    DateTimePickerAndroid.open({
      value: current,
      mode: "date",
      onChange: (dateEvent: DateTimePickerEvent, pickedDate?: Date) => {
        if (dateEvent.type !== "set" || !pickedDate) return;

        // Chained, not nested in one dialog: Android's picker does one mode at a time.
        // Dismissing the time step leaves the date unapplied, which is the right outcome —
        // a half-answered question should not commit half an answer.
        DateTimePickerAndroid.open({
          value: pickedDate,
          mode: "time",
          is24Hour: true,
          onChange: (timeEvent: DateTimePickerEvent, pickedTime?: Date) => {
            if (timeEvent.type !== "set" || !pickedTime) return;

            const combined = new Date(pickedDate);
            combined.setHours(pickedTime.getHours(), pickedTime.getMinutes(), 0, 0);
            onChange(combined);
          },
        });
      },
    });
  };

  const onPress = () => {
    if (Platform.OS === "android") openAndroid();
    else setIosPickerOpen((open) => !open);
  };

  return (
    <View style={styles.wrapper}>
      <AppText variant="label" style={styles.label}>
        {label}
      </AppText>

      <Pressable
        onPress={onPress}
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

      {Platform.OS === "ios" && iosPickerOpen ? (
        <DateTimePicker
          value={current}
          mode="datetime"
          display="spinner"
          onChange={(_event: DateTimePickerEvent, picked?: Date) => {
            if (picked) onChange(picked);
          }}
        />
      ) : null}

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
