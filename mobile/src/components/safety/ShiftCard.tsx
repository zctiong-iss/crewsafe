/**
 * The worker's own shift: task, intensity, window, and where they are in the seven-day
 * acclimatisation ramp (FR-07).
 *
 * Acclimatisation is shown whenever it applies rather than tucked into a detail view: a
 * worker on day 3 of 7 is under a restricted deployment they should be able to see, and it
 * is the field most likely to be news to them.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import { cardSurface } from "@/styles/sharedStyles";
import { formatTime } from "@/helpers/dateTime";
import type { MyShift } from "@/types/domain";

const ShiftCard: FC<{ shift: MyShift; locale: string }> = ({ shift, locale }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const rows = [
    { label: t("shift.task"), value: shift.assignment.taskName ?? t("shift.noTask") },
    { label: t("shift.intensity"), value: t(`intensity.${shift.assignment.intensity}`) },
    {
      label: t("shift.title"),
      value: t("shift.window", {
        start: formatTime(shift.startsAt, locale),
        end: formatTime(shift.endsAt, locale),
      }),
    },
  ];

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
      ]}
    >
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <AppText variant="caption" tone="secondary">
            {row.label}
          </AppText>
          <AppText variant="body" style={styles.value}>
            {row.value}
          </AppText>
        </View>
      ))}

      {shift.assignment.acclimatisationDay !== null ? (
        <View
          style={[
            styles.acclimatisation,
            {
              borderColor: theme.colors.warning,
              borderWidth: theme.metrics.borderWidth,
              borderRadius: theme.metrics.radius / 2,
            },
          ]}
        >
          <AppText variant="label" tone="warning">
            {t("shift.acclimatisation", { day: shift.assignment.acclimatisationDay })}
          </AppText>
        </View>
      ) : null}
    </View>
  );
};

export default ShiftCard;

const styles = StyleSheet.create({
  card: {
    padding: s(14),
    marginTop: vs(12),
  },
  row: {
    marginBottom: vs(10),
  },
  value: {
    marginTop: vs(2),
  },
  acclimatisation: {
    padding: s(10),
    marginTop: vs(2),
  },
});
