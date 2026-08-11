/**
 * One worker's rest and hydration, as a supervisor reads it (US-11).
 *
 * ── THE ABSENT ROW IS THE IMPORTANT ONE ─────────────────────────────────────────────────
 * The endpoint only returns workers who have logged something, so a worker with nothing shows
 * `null` here and renders "nothing logged yet". That is the row a supervisor most needs to see —
 * somebody four hours into a heavy shift who has recorded no water — and it would be invisible if
 * this component quietly skipped the empty case.
 *
 * ── "INSTRUCTED" IS NOT A FOOTNOTE ──────────────────────────────────────────────────────
 * A crew that rests only when told to is coping differently from one that rests on its own, and
 * the tag is the only thing on screen that says which. It sits beside the time rather than under
 * it for that reason.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import { formatTime } from "@/helpers/dateTime";
import { useTheme } from "@/theme/ThemeProvider";
import type { CrewWellbeingRow as CrewWellbeingRowData } from "@/types/domain";

interface CrewWellbeingRowProps {
  workerName: string;
  /** Null when this worker has logged nothing at all — rendered, not hidden. */
  row: CrewWellbeingRowData | null;
  locale: string;
}

const CrewWellbeingRow: FC<CrewWellbeingRowProps> = ({ workerName, row, locale }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={[styles.row, { borderTopColor: theme.colors.border }]}>
      <AppText variant="label">{workerName}</AppText>

      {row === null ? (
        <AppText variant="caption" tone="warning">
          {t("wellbeing.nothingLogged")}
        </AppText>
      ) : (
        <>
          <View style={styles.line}>
            <AppText variant="caption" tone="secondary" style={styles.label}>
              {t("wellbeing.lastRest")}
            </AppText>
            <AppText variant="caption" style={styles.value}>
              {row.lastRestAt
                ? `${formatTime(row.lastRestAt, locale)} · ${
                    row.lastRestSource === "INSTRUCTED"
                      ? t("wellbeing.instructed")
                      : t("wellbeing.selfLogged")
                  } · ${t("wellbeing.restCount", { count: row.restCount })}`
                : t("wellbeing.notLoggedYet")}
            </AppText>
          </View>

          <View style={styles.line}>
            <AppText variant="caption" tone="secondary" style={styles.label}>
              {t("wellbeing.lastDrink")}
            </AppText>
            <AppText variant="caption" style={styles.value}>
              {row.lastHydrationAt
                ? `${formatTime(row.lastHydrationAt, locale)} · ${t("wellbeing.drinkCount", {
                    count: row.hydrationCount,
                  })}`
                : t("wellbeing.notLoggedYet")}
            </AppText>
          </View>
        </>
      )}
    </View>
  );
};

export default CrewWellbeingRow;

const styles = StyleSheet.create({
  row: {
    marginTop: vs(8),
    paddingTop: vs(8),
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: vs(2),
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  label: {
    marginEnd: s(10),
  },
  value: {
    // Wraps inside the card rather than running past its edge: the composed string carries a
    // time, a source and a count, and grows further at large text sizes.
    flexShrink: 1,
    textAlign: "right",
  },
});
