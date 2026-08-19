/**
 * The app's own date / date-time picker, replacing the platform dialogs.
 *
 * ── WHY THIS REPLACED `@react-native-community/datetimepicker` ──────────────────────────
 * Two separate problems, and only one of them was the deprecation everyone noticed.
 *
 * The warnings came from the library's own `utils.js`: `onChange` is deprecated in favour of
 * `onValueChange`/`onDismiss`/`onNeutralButtonPress`. That alone was a small migration, not a
 * reason to remove anything — the package is current and maintained.
 *
 * The reason it went is the second problem. Its Android dialog is the Material one, themed by
 * the OS and its accent colour, so it rendered as a blue Material sheet in the middle of an
 * app whose entire visual language is monochrome and serif. That is not configurable from
 * managed Expo: the dialog's theme lives in Android resources this project does not have,
 * because there is no `android/` directory to put them in. Swapping to another native picker
 * would not have helped either — anything backed by the OS dialog inherits the OS's styling,
 * and anything with its own native views cannot run in Expo Go at all, which this project
 * depends on (see mobile/README.md).
 *
 * A JS picker is the only option that can actually match the theme, and it brings two things
 * the native one could not:
 *
 *   • It is testable. `DateTimePickerAndroid.open` is an imperative call into a native module,
 *     so the old code paths could not be exercised in Jest at all. This renders.
 *   • It behaves identically on both platforms, so a bug is not "an iOS bug" or "an Android
 *     bug" — there is one implementation and one set of tests.
 *
 * ── EVERYTHING IS LOCAL TIME, DELIBERATELY ──────────────────────────────────────────────
 * The grid is built from local calendar parts (`getFullYear`/`getMonth`/`getDate`) and never
 * from `toISOString`, which converts to UTC. `AppDateField` documents why that matters: a date
 * picked as the 1st in Singapore leaves as the 31st if it round-trips through UTC. The same
 * hazard applies to the grid itself — a month whose cells were derived in UTC would highlight
 * the wrong day for half of every day.
 *
 * @author Justin Chua
 */
import { useMemo, useState, type FC } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";
import { useTranslation } from "react-i18next";

import AppText from "../texts/AppText";
import AppButton from "../buttons/AppButton";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The steppers move minutes in fives — fewest taps to a realistic shift time.
 *
 * Coarse on purpose, and affordable because it is no longer the only way in: the hour and
 * minute are editable fields, so an exact 10:23 is typed rather than tapped for twenty
 * seconds. The stepper is for nudging, the keyboard is for precision.
 */
const MINUTE_STEP = 5;

const DAYS_IN_WEEK = 7;

const MAX_HOUR = 23;
const MAX_MINUTE = 59;

/** Two digits, so a typed "9" settles to "09" rather than sitting ambiguous next to ":". */
function pad(value: number): string {
  return `${value}`.padStart(2, "0");
}

export interface AppCalendarPickerProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (next: Date) => void;
  /** Where the picker opens. The caller passes "now" when nothing is chosen yet. */
  initialValue: Date;
  /** `datetime` adds the hour/minute row; `date` collects a calendar day only. */
  mode: "date" | "datetime";
  /** BCP-47, for month and weekday names. */
  locale: string;
  /** Already-translated. The modal's heading, and its accessible name. */
  title: string;
}

/** Midnight local on the same calendar day — never a UTC boundary. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * The cells of one month, padded with nulls so the 1st lands under its weekday.
 *
 * Nulls rather than the neighbouring months' days: a greyed-out 31st of July sitting under
 * "August 2026" is a thing people tap by mistake, and there is no reason to offer it when
 * the month arrows are right there.
 */
function monthGrid(year: number, month: number): (Date | null)[] {
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();

  const cells: (Date | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(year, month, day));
  }
  // Pad the final row so the grid stays rectangular and the last week does not stretch.
  while (cells.length % DAYS_IN_WEEK !== 0) {
    cells.push(null);
  }
  return cells;
}

/**
 * Localised weekday initials, Sunday first.
 *
 * Built from a known Sunday (2024-01-07) rather than a hardcoded list, so every locale gets
 * its own letters instead of English ones transliterated. Sunday-first matches the grid's
 * `getDay()` padding above; making the first day locale-dependent would need both to agree
 * and is not worth the coupling for an app used in one country.
 */
export const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function weekdayInitials(locale: string): { key: (typeof WEEKDAY_KEYS)[number]; initial: string }[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const sunday = new Date(2024, 0, 7);
  return WEEKDAY_KEYS.map((key, index) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + index);
    return { key, initial: formatter.format(date) };
  });
}

function monthLabel(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date);
}

/** Stable local-calendar identity for a non-interactive grid cell. */
export function calendarCellKey(date: Date): string {
  return `blank-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** The full date, spoken. Screen readers should not have to read a bare number out of a grid. */
function spokenDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(date);
}

const AppCalendarPicker: FC<AppCalendarPickerProps> = ({
  visible,
  onCancel,
  onConfirm,
  initialValue,
  mode,
  locale,
  title,
}) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation();

  /*
   * Draft state, committed only on Confirm.
   *
   * The native dialog worked this way too, and it is the behaviour that matters most here: a
   * supervisor scrolling through months to find a date has not chosen anything yet, and a
   * picker that wrote every tap straight through would edit the form under them. Cancel must
   * leave the field exactly as it was.
   */
  const [draft, setDraft] = useState(initialValue);
  const [visibleMonth, setVisibleMonth] = useState(startOfDay(initialValue));

  /*
   * The typed text is held separately from the draft, and that separation is the whole point.
   *
   * Deriving the field's value from `draft` would make it impossible to type: clearing the
   * box to retype an hour produces an empty string, which is not a number, so the field would
   * snap back to its old value between keystrokes. Holding the raw text lets a half-finished
   * entry exist while the draft keeps the last value that actually parsed.
   */
  const [hourText, setHourText] = useState(pad(initialValue.getHours()));
  const [minuteText, setMinuteText] = useState(pad(initialValue.getMinutes()));

  /*
   * Re-seed when the picker is reopened. `key` on the parent would do this too, but this
   * keeps the reset next to the reason for it: the draft belongs to one opening of the modal,
   * and reopening after a Cancel must not resurrect the abandoned draft.
   */
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      setDraft(initialValue);
      setVisibleMonth(startOfDay(initialValue));
      setHourText(pad(initialValue.getHours()));
      setMinuteText(pad(initialValue.getMinutes()));
    }
  }

  const cells = useMemo(
    () => monthGrid(visibleMonth.getFullYear(), visibleMonth.getMonth()),
    [visibleMonth],
  );
  const gridStart = useMemo(
    () => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1 - visibleMonth.getDay()),
    [visibleMonth],
  );
  const initials = useMemo(() => weekdayInitials(locale), [locale]);
  const today = useMemo(() => startOfDay(new Date()), []);

  const shiftMonth = (delta: number) => {
    setVisibleMonth((current) =>
      // Day 1 before shifting: from the 31st, +1 month lands in the month after next, because
      // the shorter month has no 31st to land on.
      new Date(current.getFullYear(), current.getMonth() + delta, 1),
    );
  };

  const pickDay = (day: Date) => {
    // Carries the draft's time across, so choosing a different day does not silently reset
    // a time the supervisor already set.
    setDraft(
      new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        draft.getHours(),
        draft.getMinutes(),
        0,
        0,
      ),
    );
  };

  const shiftMinutes = (delta: number) => {
    // Date arithmetic rather than setHours, so stepping past midnight rolls the day rather
    // than wrapping to the same day's other end.
    const next = new Date(draft.getTime() + delta * 60_000);
    setDraft(next);
    // The fields follow the stepper. Without this the two controls would disagree about the
    // same value, and whichever the supervisor looked at last would be the one they trusted.
    setHourText(pad(next.getHours()));
    setMinuteText(pad(next.getMinutes()));
  };

  /** Applies an hour/minute to the draft, keeping the chosen calendar day. */
  const applyTime = (hours: number, minutes: number) => {
    setDraft(
      new Date(draft.getFullYear(), draft.getMonth(), draft.getDate(), hours, minutes, 0, 0),
    );
  };

  /**
   * Typing is unrestricted while the field has focus; only what parses in range reaches the
   * draft.
   *
   * Rejecting out-of-range keystrokes outright reads well until someone types "5" intending
   * "59" — the first digit is valid, the second would be refused, and the field fights the
   * person using it. Letting the text be anything and committing only valid values keeps
   * mid-entry states possible without ever committing nonsense.
   */
  const onTimeTextChange = (raw: string, unit: "hour" | "minute") => {
    // Digits only: the numeric keypad still offers separators on some locales, and a stray
    // "." would silently make the whole value unparseable.
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    const limit = unit === "hour" ? MAX_HOUR : MAX_MINUTE;

    if (unit === "hour") setHourText(digits);
    else setMinuteText(digits);

    if (digits === "") return;
    const parsed = Number(digits);
    if (parsed > limit) return;

    if (unit === "hour") applyTime(parsed, draft.getMinutes());
    else applyTime(draft.getHours(), parsed);
  };

  /**
   * On blur the field settles: out of range clamps, empty or unparseable reverts to the draft.
   *
   * Reverting rather than zeroing matters — a supervisor who clears the hour to retype it and
   * then taps elsewhere gets the time they had, not midnight. Nothing here can leave the
   * field showing a value the draft does not hold.
   */
  const onTimeBlur = (unit: "hour" | "minute") => {
    const text = unit === "hour" ? hourText : minuteText;
    const limit = unit === "hour" ? MAX_HOUR : MAX_MINUTE;
    const fallback = unit === "hour" ? draft.getHours() : draft.getMinutes();

    const parsed = text === "" ? Number.NaN : Number(text);
    const settled = Number.isNaN(parsed) ? fallback : Math.min(limit, Math.max(0, parsed));

    if (unit === "hour") {
      setHourText(pad(settled));
      applyTime(settled, draft.getMinutes());
    } else {
      setMinuteText(pad(settled));
      applyTime(draft.getHours(), settled);
    }
  };

  const cellSize = Math.max(theme.metrics.minTouchTarget, vs(36) * theme.fontScale);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      // Android's hardware back must cancel the picker, not leave the screen behind it.
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />

        <View
          style={[
            styles.panel,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: theme.metrics.borderWidth,
              borderRadius: theme.metrics.radius,
              marginBottom: insets.bottom,
            },
          ]}
        >
          <AppText variant="subtitle" style={styles.title}>
            {title}
          </AppText>

          {/* Month navigation. Arrows are icon buttons with spoken labels, not bare glyphs. */}
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => shiftMonth(-1)}
              accessibilityRole="button"
              accessibilityLabel={t("datePicker.previousMonth")}
              hitSlop={s(8)}
              style={[styles.monthArrow, { minWidth: theme.metrics.minTouchTarget }]}
            >
              <Ionicons name="chevron-back" size={s(20)} color={theme.colors.textPrimary} />
            </Pressable>

            <AppText variant="label" style={styles.monthLabel}>
              {monthLabel(visibleMonth, locale)}
            </AppText>

            <Pressable
              onPress={() => shiftMonth(1)}
              accessibilityRole="button"
              accessibilityLabel={t("datePicker.nextMonth")}
              hitSlop={s(8)}
              style={[styles.monthArrow, { minWidth: theme.metrics.minTouchTarget }]}
            >
              <Ionicons name="chevron-forward" size={s(20)} color={theme.colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {initials.map(({ key, initial }) => (
              <View
                key={key}
                style={[styles.cell, { width: cellSize }]}
              >
                {/* Decorative: the grid's own buttons already speak their full date, so
                    repeating the column letter would just add noise for a screen reader. */}
                <AppText variant="caption" tone="secondary" accessibilityElementsHidden>
                  {initial}
                </AppText>
              </View>
            ))}
          </View>

          <ScrollView
            style={styles.gridScroll}
            contentContainerStyle={styles.grid}
            // The grid is short; scrolling only matters at large text sizes, where the rows
            // grow past the panel.
            showsVerticalScrollIndicator={false}
          >
            {cells.map((day, index) => {
              if (!day) {
                const blankDate = new Date(gridStart);
                blankDate.setDate(gridStart.getDate() + index);
                return (
                  <View
                    key={calendarCellKey(blankDate)}
                    style={[styles.cell, { width: cellSize }]}
                  />
                );
              }
              const selected = isSameDay(day, draft);
              const isToday = isSameDay(day, today);

              return (
                <Pressable
                  key={day.toDateString()}
                  onPress={() => pickDay(day)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={spokenDate(day, locale)}
                  style={[
                    styles.cell,
                    {
                      width: cellSize,
                      height: cellSize,
                      borderRadius: cellSize / 2,
                      // Selection is a filled disc in the app's own ink, not the OS accent.
                      backgroundColor: selected ? theme.colors.textPrimary : "transparent",
                      // Today is outlined rather than filled, so "today" and "chosen" stay
                      // distinguishable when they are different days — and when they are the
                      // same day, the fill wins and the ring is redundant rather than wrong.
                      borderWidth: !selected && isToday ? theme.metrics.borderWidth : 0,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                >
                  <AppText
                    variant="body"
                    // Inverted on the filled disc. Passed as a style rather than a tone
                    // because "the colour of the surface" is not one of the tones.
                    style={selected ? { color: theme.colors.surface } : undefined}
                  >
                    {day.getDate()}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>

          {mode === "datetime" ? (
            <View style={[styles.timeRow, { borderTopColor: theme.colors.border }]}>
              <AppText variant="label">{t("datePicker.time")}</AppText>

              <View style={styles.timeControls}>
                <Pressable
                  onPress={() => shiftMinutes(-60)}
                  accessibilityRole="button"
                  accessibilityLabel={t("datePicker.hourDown")}
                  hitSlop={s(8)}
                  style={[styles.stepper, { minWidth: theme.metrics.minTouchTarget }]}
                >
                  <Ionicons name="remove" size={s(18)} color={theme.colors.textPrimary} />
                </Pressable>

                {/* 24-hour, matching the rest of the app and the old picker's is24Hour. */}
                <TextInput
                  testID="datePicker-hour"
                  value={hourText}
                  onChangeText={(raw) => onTimeTextChange(raw, "hour")}
                  onBlur={() => onTimeBlur("hour")}
                  keyboardType="number-pad"
                  maxLength={2}
                  // Selects the existing value so typing replaces it. Without this, tapping a
                  // field showing "14" and typing "9" gives "149" truncated to "14" — the
                  // entry appears to do nothing.
                  selectTextOnFocus
                  accessibilityLabel={t("datePicker.hourInput")}
                  style={[
                    styles.timeInput,
                    {
                      color: theme.colors.textPrimary,
                      borderColor: theme.colors.border,
                      borderWidth: theme.metrics.borderWidth,
                      borderRadius: theme.metrics.radius,
                      minHeight: theme.metrics.minTouchTarget,
                    },
                  ]}
                />

                <Pressable
                  onPress={() => shiftMinutes(60)}
                  accessibilityRole="button"
                  accessibilityLabel={t("datePicker.hourUp")}
                  hitSlop={s(8)}
                  style={[styles.stepper, { minWidth: theme.metrics.minTouchTarget }]}
                >
                  <Ionicons name="add" size={s(18)} color={theme.colors.textPrimary} />
                </Pressable>

                <AppText variant="subtitle">:</AppText>

                <Pressable
                  onPress={() => shiftMinutes(-MINUTE_STEP)}
                  accessibilityRole="button"
                  accessibilityLabel={t("datePicker.minuteDown")}
                  hitSlop={s(8)}
                  style={[styles.stepper, { minWidth: theme.metrics.minTouchTarget }]}
                >
                  <Ionicons name="remove" size={s(18)} color={theme.colors.textPrimary} />
                </Pressable>

                <TextInput
                  testID="datePicker-minute"
                  value={minuteText}
                  onChangeText={(raw) => onTimeTextChange(raw, "minute")}
                  onBlur={() => onTimeBlur("minute")}
                  keyboardType="number-pad"
                  maxLength={2}
                  selectTextOnFocus
                  accessibilityLabel={t("datePicker.minuteInput")}
                  style={[
                    styles.timeInput,
                    {
                      color: theme.colors.textPrimary,
                      borderColor: theme.colors.border,
                      borderWidth: theme.metrics.borderWidth,
                      borderRadius: theme.metrics.radius,
                      minHeight: theme.metrics.minTouchTarget,
                    },
                  ]}
                />

                <Pressable
                  onPress={() => shiftMinutes(MINUTE_STEP)}
                  accessibilityRole="button"
                  accessibilityLabel={t("datePicker.minuteUp")}
                  hitSlop={s(8)}
                  style={[styles.stepper, { minWidth: theme.metrics.minTouchTarget }]}
                >
                  <Ionicons name="add" size={s(18)} color={theme.colors.textPrimary} />
                </Pressable>
              </View>
            </View>
          ) : null}

          {/*
            Each button is wrapped in a flexed View rather than flexed itself. AppButton is
            deliberately `width: "100%"` (see its own comment on Yoga sizing the row to its
            label), so two of them in a row makes the first claim the full width and pushes
            the second off the panel — which is exactly what happened to Cancel, leaving the
            backdrop and the hardware back button as the only ways out.
          */}
          <View style={styles.actions}>
            <View style={styles.action}>
              <AppButton title={t("common.cancel")} variant="secondary" onPress={onCancel} />
            </View>
            <View style={[styles.action, styles.confirm]}>
              <AppButton title={t("common.confirm")} onPress={() => onConfirm(draft)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default AppCalendarPicker;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  panel: {
    marginHorizontal: s(12),
    padding: s(16),
  },
  title: {
    marginBottom: vs(10),
  },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: vs(8),
  },
  monthArrow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(4),
  },
  monthLabel: {
    flex: 1,
    textAlign: "center",
  },
  weekdayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  gridScroll: {
    // Caps the panel at large text sizes rather than pushing the actions off screen.
    maxHeight: vs(280),
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(4),
  },
  timeRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: vs(10),
    paddingTop: vs(10),
  },
  timeControls: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: vs(6),
  },
  stepper: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(6),
  },
  timeInput: {
    minWidth: s(52),
    marginHorizontal: s(4),
    paddingHorizontal: s(8),
    textAlign: "center",
    // Matches AppText's "subtitle" so the field reads as part of the same row as the ":".
    fontSize: s(16),
  },
  actions: {
    flexDirection: "row",
    marginTop: vs(14),
  },
  action: {
    flex: 1,
  },
  confirm: {
    marginStart: s(10),
  },
});
