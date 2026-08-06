/**
 * A shift's status as a compact coloured pill.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import type { ShiftStatus } from "@/types/domain";

/**
 * PLANNED / ACTIVE / CLOSED.
 *
 * Server-controlled — a client cannot set it, and every shift is created PLANNED. So this
 * only ever reports; there is no variant of it that is also a control, deliberately.
 */
const ShiftStatusPill: FC<{ status: ShiftStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const color: Record<ShiftStatus, string> = {
    // Neutral: planned is not a state anyone needs to act on.
    PLANNED: theme.colors.textSecondary,
    // The one worth spotting in a list — people are on site right now.
    ACTIVE: theme.colors.success,
    CLOSED: theme.colors.textSecondary,
  };

  return (
    <View
      style={[
        styles.pill,
        {
          borderColor: color[status],
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius / 2,
          // Filled only when ACTIVE. Outline everywhere else keeps the emphasis where it
          // belongs — three filled pills in a list is three things shouting equally.
          backgroundColor: status === "ACTIVE" ? color[status] : "transparent",
        },
      ]}
    >
      <AppText
        variant="caption"
        style={{ color: status === "ACTIVE" ? theme.colors.textInverse : color[status] }}
      >
        {t(`shifts.status.${status}`)}
      </AppText>
    </View>
  );
};

export default ShiftStatusPill;

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(8),
    paddingVertical: vs(2),
    alignSelf: "flex-start",
  },
});
