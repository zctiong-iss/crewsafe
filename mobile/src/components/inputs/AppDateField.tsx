/**
 * A date-only field (SCRUM-120).
 *
 * ── WHY NOT REUSE `AppDateTimeField` ────────────────────────────────────────────────────
 * That component chains a date dialog into a time dialog and returns a full `Date`. A policy
 * version's `effectiveDate` is a `LocalDate` server-side — there is no time to collect, and
 * collecting one would either be discarded silently or, worse, shift the date across a timezone
 * boundary on the way out. Asking a question whose answer is thrown away is also just a second
 * dialog between a safety manager and the thing they came to do.
 *
 * ── THE VALUE IS A STRING, NOT A `Date` ─────────────────────────────────────────────────
 * `YYYY-MM-DD`, which is exactly what the server parses. A `Date` here would invite
 * `toISOString()` at the call site, and that converts to UTC — so a date picked as the 1st in
 * Singapore leaves as the 31st. Keeping the wire format all the way to the picker removes the
 * conversion entirely rather than getting it right once and hoping.
 *
 * @author Justin Chua
 */
import { useState, type FC } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import AppCalendarPicker from "./AppCalendarPicker";
import { useTheme } from "@/theme/ThemeProvider";
import { formatDate } from "@/helpers/dateTime";

interface AppDateFieldProps {
  label: string;
  /** `YYYY-MM-DD`, or null when nothing has been picked. */
  value: string | null;
  onChange: (next: string) => void;
  errorMessage?: string;
  placeholder: string;
  locale: string;
}

/**
 * Local calendar parts, never UTC.
 *
 * `new Date("2026-08-11")` parses as UTC midnight, which in Singapore is the 11th at 08:00 — fine
 * — but in any negative offset it is the 10th. Splitting the string keeps the date the user
 * actually typed.
 */
function toLocalDate(value: string | null): Date {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The reverse: local calendar parts back to `YYYY-MM-DD`, with no timezone in the middle. */
function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const AppDateField: FC<AppDateFieldProps> = ({
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

  const current = toLocalDate(value);

  return (
    <View style={styles.wrapper}>
      <AppText variant="label" style={styles.label}>
        {label}
      </AppText>

      <Pressable
        onPress={() => setPickerOpen(true)}
        accessibilityRole="button"
        /* The error is read with the field rather than as a separate stop, matching
           AppTextInput and AppDateTimeField. */
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
        <AppText variant="body" tone={value ? "primary" : "secondary"} style={styles.valueText}>
          {value ? formatDate(value, locale) : placeholder}
        </AppText>
        <Ionicons name="calendar-outline" size={s(20)} color={theme.colors.textSecondary} />
      </Pressable>

      {/* `mode="date"` so no time is collected — see the header note on why a discarded
          time is worse than no time. `toIsoDate` keeps the value in local calendar parts. */}
      <AppCalendarPicker
        visible={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(picked) => {
          setPickerOpen(false);
          onChange(toIsoDate(picked));
        }}
        initialValue={current}
        mode="date"
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

export default AppDateField;

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    marginBottom: vs(12),
  },
  label: {
    marginBottom: vs(6),
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(12),
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
