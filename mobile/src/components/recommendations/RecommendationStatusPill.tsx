/**
 * A recommendation's decision state as a compact coloured pill (SCRUM-119).
 *
 * Mirrors `ShiftStatusPill` deliberately — same shape, same fill rule — so a supervisor moving
 * between the two lists is reading one visual language rather than two.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import type { ApprovalDecision, RecommendationStatus } from "@/types/domain";

interface RecommendationStatusPillProps {
  status: RecommendationStatus;
  /**
   * Distinguishes "approved as drafted" from "approved with edits" — the server folds both into
   * `APPROVED`, but they are different facts about what the supervisor did, and US-09 exists to
   * keep that distinction on the record.
   */
  decision?: ApprovalDecision | null;
}

const RecommendationStatusPill: FC<RecommendationStatusPillProps> = ({ status, decision }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const pending = status === "PENDING_APPROVAL";
  const rejected = status === "REJECTED";

  // Filled only while pending: that is the one state asking someone to do something. A list of
  // decided plans should recede rather than keep shouting.
  const color = pending
    ? theme.colors.warningFill
    : rejected
      ? theme.colors.danger
      : theme.colors.success;

  const label = pending
    ? t("recommendations.pending")
    : rejected
      ? t("recommendations.decidedRejected")
      : decision === "EDITED"
        ? t("recommendations.decidedEdited")
        : t("recommendations.decidedApproved");

  return (
    <View
      style={[
        styles.pill,
        {
          borderColor: color,
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius / 2,
          backgroundColor: pending ? color : "transparent",
        },
      ]}
    >
      <AppText
        variant="caption"
        style={{ color: pending ? theme.colors.textInverse : color }}
      >
        {label}
      </AppText>
    </View>
  );
};

export default RecommendationStatusPill;

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(8),
    paddingVertical: vs(2),
    alignSelf: "flex-start",
  },
});
