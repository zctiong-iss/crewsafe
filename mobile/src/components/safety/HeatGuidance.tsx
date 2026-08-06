/**
 * The heat plan — what the policy engine says this worker must and should do.
 *
 * ── THE OVERRIDE ────────────────────────────────────────────────────────────────────────
 * FR-12a: "stop-work shall visibly override the heat plan until cleared." §7.1 is stronger
 * still — a lightning stop-work "suspends the heat rest/hydration plan" and overrides every
 * heat-based action.
 *
 * So when a stop-work is in force this does not merely dim: it says, in words, that the
 * plan is suspended and why. Dimming alone is ambiguous — a worker could read a faded list
 * as "loading" or as a rendering quirk and follow it anyway. Following a hydration schedule
 * instead of taking shelter is exactly the outcome the override exists to prevent.
 *
 * The actions themselves stay on screen rather than being removed, so the worker can see
 * what resumes once the supervisor gives the all-clear.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";
import { cardSurface } from "@/styles/sharedStyles";
import { humaniseActionCode } from "@/helpers/actionCodes";
import type { PolicyAction, PolicyEvaluation } from "@/types/domain";

interface HeatGuidanceProps {
  policy: PolicyEvaluation;
  /** True while a lightning stop-work is active. */
  suspended: boolean;
}

const HeatGuidance: FC<HeatGuidanceProps> = ({ policy, suspended }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const renderAction = (item: PolicyAction, mandatory: boolean) => (
    <View key={`${item.code}-${item.ruleReference}`} style={styles.actionRow}>
      <Ionicons
        name={mandatory ? "alert-circle" : "information-circle-outline"}
        size={s(18)}
        color={suspended ? theme.colors.disabled : theme.colors.textPrimary}
        style={styles.actionIcon}
      />
      {/* flex:1 so a long translated instruction wraps under itself rather than running
          past the card edge. */}
      <View style={styles.actionBody}>
        <AppText variant="body" tone={suspended ? "secondary" : "primary"}>
          {/* Falls back to the raw code rather than rendering nothing: the action catalogue
              is open-ended (REST_10_MIN, HYDRATE, STOP_WORK, ...) and the backend can add
              one before this app ships a translation for it. An untranslated instruction is
              recoverable; a silently missing one is not. */}
          {t(`actions.${item.code}`, { defaultValue: humaniseActionCode(item.code) })}
        </AppText>
        <AppText variant="caption" tone="secondary" style={styles.rule}>
          {t("guidance.rule", { ref: item.ruleReference })}
        </AppText>
      </View>
    </View>
  );

  const hasAny = policy.mandatoryActions.length > 0 || policy.advisoryActions.length > 0;

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
      ]}
    >
      {suspended ? (
        <View
          style={[
            styles.suspendedNotice,
            {
              borderColor: theme.colors.danger,
              borderWidth: theme.metrics.borderWidth,
              borderRadius: theme.metrics.radius / 2,
            },
          ]}
        >
          <Ionicons name="pause-circle" size={s(18)} color={theme.colors.danger} />
          <AppText variant="label" tone="danger" style={styles.suspendedText}>
            {t("guidance.suspended")}
          </AppText>
        </View>
      ) : null}

      {policy.mandatoryActions.length > 0 ? (
        <>
          <AppText variant="subtitle" style={styles.sectionTitle}>
            {t("guidance.title")}
          </AppText>
          {policy.mandatoryActions.map((item) => renderAction(item, true))}
        </>
      ) : null}

      {policy.advisoryActions.length > 0 ? (
        <>
          <AppText variant="subtitle" style={styles.sectionTitle}>
            {t("guidance.advisoryTitle")}
          </AppText>
          {policy.advisoryActions.map((item) => renderAction(item, false))}
        </>
      ) : null}

      {!hasAny ? (
        <AppText variant="body" tone="secondary">
          {t("guidance.none")}
        </AppText>
      ) : null}

      {/* FR-16: every recommendation references the policy version that produced it. */}
      <AppText variant="caption" tone="secondary" style={styles.version}>
        {t("guidance.policyVersion", { version: policy.policyVersion })}
      </AppText>
    </View>
  );
};

export default HeatGuidance;

const styles = StyleSheet.create({
  card: {
    padding: s(14),
    marginTop: vs(12),
  },
  suspendedNotice: {
    flexDirection: "row",
    alignItems: "center",
    padding: s(10),
    marginBottom: vs(12),
  },
  suspendedText: {
    flex: 1,
    marginStart: s(8),
  },
  sectionTitle: {
    marginTop: vs(4),
    marginBottom: vs(8),
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: vs(10),
  },
  actionIcon: {
    marginTop: vs(2),
    marginEnd: s(8),
  },
  actionBody: {
    flex: 1,
  },
  rule: {
    marginTop: vs(2),
  },
  version: {
    marginTop: vs(6),
  },
});
