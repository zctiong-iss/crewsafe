/**
 * A policy version's standing, as a compact pill (SCRUM-120).
 *
 * Mirrors `ShiftStatusPill` and `RecommendationStatusPill` — same shape, same fill rule — so a
 * safety manager moving between lists is reading one visual language.
 *
 * Only the active one is filled. A version history is mostly retired versions, and three filled
 * pills down a screen is three things claiming equal weight when exactly one of them governs
 * anything.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import type { PolicyVersionStatus } from "@/types/domain";

const PolicyStatusPill: FC<{ status: PolicyVersionStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const active = status === "ACTIVE";
  const color = active
    ? theme.colors.success
    : status === "DRAFT"
      ? theme.colors.warningFill
      : theme.colors.textSecondary;

  const label =
    status === "ACTIVE"
      ? t("policy.statusActive")
      : status === "DRAFT"
        ? t("policy.statusDraft")
        : t("policy.statusSuperseded");

  return (
    <View
      style={[
        styles.pill,
        {
          borderColor: color,
          borderWidth: theme.metrics.borderWidth,
          borderRadius: theme.metrics.radius / 2,
          backgroundColor: active ? color : "transparent",
        },
      ]}
    >
      {/* One line: a pill that wraps paints its second line outside its own fill — the defect
          SCRUM-119's status pill was fixed for. The labels are short enough that an ellipsis
          should never appear, and if one does it is telling the truth. */}
      <AppText
        variant="caption"
        numberOfLines={1}
        style={[styles.label, { color: active ? theme.colors.textInverse : color }]}
      >
        {label}
      </AppText>
    </View>
  );
};

export default PolicyStatusPill;

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: s(8),
    paddingVertical: vs(2),
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
  },
  label: {
    flexShrink: 1,
  },
});
