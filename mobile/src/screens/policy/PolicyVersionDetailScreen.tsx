/**
 * One policy version, and the decision to put it in force (SCRUM-120 / US-24).
 *
 * ── ACTIVATION NAMES WHAT IT RETIRES ────────────────────────────────────────────────────
 * Activating changes the rules an entire site is judged against, and there is no un-activate
 * endpoint — reverting means activating the previous version again, which correctly leaves two
 * activation events on the record for one mistake. So the confirmation says which version is being
 * replaced rather than asking a generic "are you sure": the safety manager should be able to check
 * the consequence, not just consent to one.
 *
 * ── EVERY THRESHOLD, LABELLED ───────────────────────────────────────────────────────────
 * Nine numbers in three groups, least-acclimatised first. A worker on day 2 is who the strictest
 * thresholds protect, so their row is the one read first rather than the one scrolled past.
 *
 * @author Justin Chua
 */
import { useCallback } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import PolicyStatusPill from "@/components/policy/PolicyStatusPill";
import { THRESHOLD_GRID } from "@/components/policy/policyThresholds";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { activatePolicyVersion, selectActiveVersion } from "@/store/reducers/policySlice";
import { showToast } from "@/store/reducers/uiSlice";
import { formatDate, formatDateTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { intensityColor } from "@/helpers/intensityColor";
import { useTheme } from "@/theme/ThemeProvider";
import type { ProfileStackParamList } from "@/navigation/types";

export default function PolicyVersionDetailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const route = useRoute<RouteProp<ProfileStackParamList, "PolicyVersionDetail">>();
  const { versionId } = route.params;

  const version = useAppSelector((state) =>
    state.policy.versions.find((item) => item.id === versionId),
  );
  const active = useAppSelector(selectActiveVersion);
  const activatingId = useAppSelector((state) => state.policy.activatingId);
  const user = useAppSelector((state) => state.auth.user);
  const selectedSiteId = useAppSelector((state) => state.shifts.selectedSiteId);

  const siteId = selectedSiteId ?? user?.siteIds[0] ?? null;
  const canConfigure = user?.role === "SAFETY_MANAGER" || user?.role === "ADMIN";

  const onActivate = useCallback(() => {
    if (!version || !siteId) return;

    /*
     * Two bodies, because a site's first activation is a different event from a replacement.
     * Naming a version that does not exist would be worse than saying less.
     */
    const body = active
      ? t("policy.activateBody", { incoming: version.versionLabel, outgoing: active.versionLabel })
      : t("policy.activateBodyFirst", { incoming: version.versionLabel });

    Alert.alert(t("policy.activateTitle"), body, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("policy.activateConfirm"),
        onPress: async () => {
          const result = await dispatch(activatePolicyVersion({ siteId, versionId: version.id }));
          if (activatePolicyVersion.fulfilled.match(result)) {
            dispatch(showToast({ messageKey: "policy.statusActive", tone: "success" }));
            return;
          }

          /* A 409 here is one of two different facts — already active, or superseded and
             terminal — and telling a safety manager which one decides what they do next. */
          const key = result.payload?.errorKey ?? "errors.unknown";
          let message = t(key);
          if (key === "errors.conflict") {
            message = version.status === "SUPERSEDED"
              ? t("policy.supersededCannotActivate")
              : t("policy.alreadyActive");
          }
          Alert.alert(t("policy.activateFailedTitle"), message, [{ text: t("common.close") }]);
        },
      },
    ]);
  }, [active, dispatch, siteId, t, version]);

  /* Gone from the list the moment a reload drops it, which is when this screen unmounts. */
  if (!version) return null;

  const activating = activatingId === version.id;
  // Only a DRAFT can be put in force: ACTIVE already is, and SUPERSEDED is terminal server-side.
  const activatable = canConfigure && version.status === "DRAFT";

  return (
    <AppSafeView>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.card,
            cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
            { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
          ]}
        >
          <View style={styles.cardHeader}>
            <AppText variant="title" style={styles.cardTitle}>
              {version.versionLabel}
            </AppText>
            <PolicyStatusPill status={version.status} />
          </View>

          <AppText variant="caption" tone="secondary" style={styles.metaLine}>
            {t("policy.effectiveFrom", { date: formatDate(version.effectiveDate, i18n.language) })}
          </AppText>

          {version.activatedAt ? (
            <AppText variant="caption" tone="secondary">
              {t("policy.activeSince", {
                date: formatDateTime(version.activatedAt, i18n.language),
              })}
            </AppText>
          ) : null}

          {version.supersededAt ? (
            <AppText variant="caption" tone="secondary">
              {t("policy.retiredOn", {
                date: formatDateTime(version.supersededAt, i18n.language),
              })}
            </AppText>
          ) : null}
        </View>

        {/* ─────────────────────── Where the rules came from ─────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("policy.source")}
        </AppText>
        <AppText variant="body" style={styles.block}>
          {version.source}
        </AppText>

        {version.notes ? (
          <>
            <AppText variant="subtitle" style={styles.sectionTitle}>
              {t("policy.notes")}
            </AppText>
            <AppText variant="body" style={styles.block}>
              {version.notes}
            </AppText>
          </>
        ) : null}

        {/* ───────────────────────────── The thresholds ──────────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("policy.thresholdsTitle")}
        </AppText>

        {THRESHOLD_GRID.map((row) => (
          <View
            key={row.level}
            style={[
              styles.card,
              cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
              { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
            ]}
          >
            <AppText variant="caption" tone="secondary">
              {t("policy.levelHint")}
            </AppText>
            <AppText variant="label">{t(`policy.level${row.level}`)}</AppText>

            {row.cells.map((cell) => (
              <View key={cell.key} style={styles.thresholdRow}>
                {/* The same green → amber → red ramp the shift screens use for intensity, so
                    "heavy" means the same colour wherever it appears. */}
                <AppText
                  variant="caption"
                  style={{ color: intensityColor(theme.colors, cell.intensity) }}
                >
                  {t(`intensity.${cell.intensity}`)}
                </AppText>
                <AppText variant="label">{version[cell.key]}</AppText>
              </View>
            ))}
          </View>
        ))}

        <View
          style={[
            styles.card,
            cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
            {
              borderRadius: theme.metrics.radius,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.danger,
            },
          ]}
        >
          <View style={styles.thresholdRow}>
            <AppText variant="label" tone="danger">
              {t("policy.emergencyStop")}
            </AppText>
            <AppText variant="label" tone="danger">
              {version.wbgtEmergencyStop}
            </AppText>
          </View>
        </View>

        {activatable ? (
          <AppButton
            title={activating ? t("policy.activating") : t("policy.activate")}
            loading={activating}
            onPress={onActivate}
            style={styles.action}
          />
        ) : null}

        {!canConfigure ? (
          <AppText variant="caption" tone="secondary" style={styles.action}>
            {t("policy.readOnlyNotice")}
          </AppText>
        ) : null}
      </ScrollView>
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(12),
  },
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  cardTitle: {
    flex: 1,
    marginEnd: s(10),
  },
  metaLine: {
    marginTop: vs(8),
  },
  sectionTitle: {
    marginBottom: vs(6),
  },
  block: {
    marginBottom: vs(12),
  },
  thresholdRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: vs(8),
  },
  action: {
    marginTop: vs(8),
  },
});
