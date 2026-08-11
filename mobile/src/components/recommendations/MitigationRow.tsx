/**
 * One proposed action on a drafted plan (SCRUM-119).
 *
 * ── THE CODE IS THE TEXT; THE PROSE IS THE FALLBACK ─────────────────────────────────────
 * `actionCode` resolves through `actions.*`, which ships in all seven locales — so a supervisor
 * reading in Tamil sees the same instruction their crew will receive, in Tamil. `action` is
 * server-authored English and is only rendered when a plan predates SCRUM-119 and carries no
 * code, with a note saying so rather than passing English off as a translation.
 *
 * Never parse `action` to recover a number. It works in English and fails in the other six —
 * the same trap SCRUM-206 documents for the rest timer.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import type { Mitigation } from "@/types/domain";

interface MitigationRowProps {
  mitigation: Mitigation;
  /** Struck through and dimmed, for a row the supervisor has taken out of the plan. */
  removed?: boolean;
  /** Hidden in the edit sheet, where the rationale would bury the controls. */
  showDetail?: boolean;
}

const MitigationRow: FC<MitigationRowProps> = ({ mitigation, removed = false, showDetail = true }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  /*
   * `t()` with an explicit fallback rather than `humaniseActionCode`. A code the server knows and
   * this app does not is a contract drift worth showing honestly — the raw code plus the server's
   * own words — not smoothing over with a humanised guess that reads like a real instruction.
   */
  const label = mitigation.actionCode
    ? t(`actions.${mitigation.actionCode}`, { defaultValue: mitigation.action })
    : mitigation.action;

  const untranslated = mitigation.actionCode === null;

  return (
    <View style={[styles.row, removed && styles.removed]}>
      <AppText
        variant="body"
        style={removed ? { textDecorationLine: "line-through", color: theme.colors.textSecondary } : undefined}
      >
        {label}
      </AppText>

      {untranslated ? (
        <AppText variant="caption" tone="secondary" style={styles.notice}>
          {t("recommendations.untranslatedNotice")}
        </AppText>
      ) : null}

      {removed ? (
        <AppText variant="caption" tone="secondary" style={styles.notice}>
          {t("recommendations.removedLabel")}
        </AppText>
      ) : null}

      {showDetail && !removed ? (
        <>
          {mitigation.rationale ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">
                {t("recommendations.rationale")}
              </AppText>
              {/* Server prose, and unavoidably English — but it is evidence for the supervisor
                  judging the plan, not an instruction reaching a worker, so showing it is
                  better than hiding the reasoning the ticket exists to surface. */}
              <AppText variant="caption">{mitigation.rationale}</AppText>
            </View>
          ) : null}

          {mitigation.estimatedImpact ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">
                {t("recommendations.estimatedImpact")}
              </AppText>
              <AppText variant="caption">{mitigation.estimatedImpact}</AppText>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
};

export default MitigationRow;

const styles = StyleSheet.create({
  row: {
    paddingVertical: vs(6),
  },
  removed: {
    opacity: 0.6,
  },
  notice: {
    marginTop: vs(2),
  },
  detail: {
    marginTop: vs(6),
    paddingStart: s(8),
  },
});
