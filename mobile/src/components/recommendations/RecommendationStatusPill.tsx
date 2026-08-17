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
import type { AppPalette } from "@/styles/colors";
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

/**
 * Every status but `APPROVED` (handled separately below, since it also depends on `decision`)
 * maps to exactly one appearance. A lookup table rather than a ternary chain deciding `color`
 * and a second one deciding `label` — the chain grew one branch per ticket (DRAFT, then
 * SUPERSEDED, then AUTO_DISPATCHED) until Sonar flagged the nesting; a table scales to a new
 * status by adding a line, not by re-indenting two expressions.
 *
 * Absent from this table is exactly the old chain's fall-through: any status not listed here
 * renders as a plain approval. That used to be a bug (DRAFT and SUPERSEDED were once missing
 * and rendered green "Approved"); it is safe now only because every non-APPROVED status the
 * backend can send is listed explicitly.
 */
const STATUS_APPEARANCE: Partial<
  Record<RecommendationStatus, { colorKey: keyof AppPalette; labelKey: string }>
> = {
  // Filled only while pending: that is the one state asking someone to do something.
  PENDING_APPROVAL: { colorKey: "warningFill", labelKey: "recommendations.pending" },
  REJECTED: { colorKey: "danger", labelKey: "recommendations.decidedRejected" },
  // A draft is not yet asking anything, and a list of decided plans should recede rather than
  // keep shouting — same muted treatment as SUPERSEDED below.
  DRAFT: { colorKey: "textSecondary", labelKey: "recommendations.statusDraft" },
  // SCRUM-291: a newer auto-triggered draft replaced this one before anyone decided on it —
  // not a decision either way, so it recedes the same way DRAFT does.
  SUPERSEDED: { colorKey: "textSecondary", labelKey: "recommendations.statusSuperseded" },
  // SCRUM-440: a lightning-immediate or WBGT-max stop-work skipped approval entirely and was
  // already dispatched to workers. Also not a decision, but `danger`, not the muted grey
  // DRAFT/SUPERSEDED use — a stop-work already in effect is the most severe thing this screen
  // can show, and the colour should say so even with nothing left for the supervisor to tap.
  AUTO_DISPATCHED: { colorKey: "danger", labelKey: "recommendations.statusAutoDispatched" },
};

const RecommendationStatusPill: FC<RecommendationStatusPillProps> = ({ status, decision }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const pending = status === "PENDING_APPROVAL";
  const appearance = STATUS_APPEARANCE[status];

  const color = appearance ? theme.colors[appearance.colorKey] : theme.colors.success;

  const label = appearance
    ? t(appearance.labelKey)
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
