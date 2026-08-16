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
  /*
   * Handled by name rather than left to a fall-through.
   *
   * The previous chain ended in "otherwise, approved", so any status it did not recognise rendered
   * green and said Approved — and DRAFT is a legal value in the backend enum and the contract.
   * Nothing writes it today, but "a plan nobody approved shows as approved" is not a failure worth
   * leaving to that.
   */
  const draft = status === "DRAFT";

  /*
   * SCRUM-291: a newer auto-triggered draft replaced this one before anyone decided on it — not
   * a decision either way, so it gets the same non-fall-through treatment as DRAFT rather than
   * inheriting the "otherwise, approved" default.
   */
  const superseded = status === "SUPERSEDED";

  // Filled only while pending: that is the one state asking someone to do something. A draft is
  // not yet asking anything, and a list of decided plans should recede rather than keep shouting.
  const color = pending
    ? theme.colors.warningFill
    : rejected
      ? theme.colors.danger
      : draft || superseded
        ? theme.colors.textSecondary
        : theme.colors.success;

  const label = pending
    ? t("recommendations.pending")
    : rejected
      ? t("recommendations.decidedRejected")
      : draft
        ? t("recommendations.statusDraft")
        : superseded
          ? t("recommendations.statusSuperseded")
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
      {/*
        One line, always.

        Left to wrap, a long label breaks inside the fill and the second line renders outside the
        pill's painted background — "Waiting on your decision" showed as "Waiting on your" with
        the last word simply gone, no ellipsis to hint at it. A status pill is a compact marker
        by definition; if a translation cannot fit, an ellipsis says so honestly where a silently
        dropped word does not. The labels themselves are kept short for that reason.
      */}
      <AppText
        variant="caption"
        numberOfLines={1}
        style={[styles.label, { color: pending ? theme.colors.textInverse : color }]}
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
    /*
     * A row, not a bare box.
     *
     * `alignSelf: "flex-start"` inside a column parent measured the pill against the text's
     * *first line break opportunity* rather than the whole string, so "Waiting on your decision"
     * rendered as a pill the width of "Waiting on your" with the last word cut off — no ellipsis,
     * just gone. Laying the label out as a row item makes the pill size to the text it actually
     * contains. The longest label is the pending one, and it is longer still in Tamil and
     * Burmese, so this is not an English-only concern.
     */
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
  },
  label: {
    // Wraps to a second line inside the fill rather than overflowing it, at large text sizes
    // where even a correctly measured pill cannot fit on one line.
    flexShrink: 1,
  },
});
