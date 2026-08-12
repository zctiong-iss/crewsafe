/**
 * The site's heat policy version history (SCRUM-120 / US-24).
 *
 * ── WHY THIS IS UNDER PROFILE AND NOT A TAB ─────────────────────────────────────────────
 * A safety manager shares the supervisor tab set, which is already five tabs. Configuring policy
 * is rare and administrative — done sitting down, not mid-shift — so it does not deserve permanent
 * tab-bar space, and a sixth tab would also show supervisors a surface they can read but not act
 * in. Settings sits under Profile for the same reason.
 *
 * ── READ IS BROADER THAN WRITE ──────────────────────────────────────────────────────────
 * A supervisor sees this list: their crew is judged against these thresholds, so they are entitled
 * to know what they are. Creating and activating belong to the person accountable for the rules,
 * and the controls are simply absent rather than present-and-refused.
 *
 * @author Justin Chua
 */
import { useCallback, useEffect } from "react";
import { FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";
import PolicyStatusPill from "@/components/policy/PolicyStatusPill";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loadPolicyVersions } from "@/store/reducers/policySlice";
import { formatDate } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { ProfileStackParamList } from "@/navigation/types";

export default function PolicyVersionsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();

  const user = useAppSelector((state) => state.auth.user);
  const { versions, status, refreshing, errorKey } = useAppSelector((state) => state.policy);
  const selectedSiteId = useAppSelector((state) => state.shifts.selectedSiteId);

  const siteId = selectedSiteId ?? user?.siteIds[0] ?? null;

  /** Creating and activating are SAFETY_MANAGER/ADMIN; the server refuses anyone else. */
  const canConfigure = user?.role === "SAFETY_MANAGER" || user?.role === "ADMIN";

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!siteId) return;
      void dispatch(loadPolicyVersions({ siteId, refreshing: isRefresh }));
    },
    [dispatch, siteId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  if (status === "loading" && versions.length === 0) {
    return (
      <AppSafeView>
        <AppLoader />
      </AppSafeView>
    );
  }

  return (
    <AppSafeView>
      <FlatList
        data={versions}
        keyExtractor={(item) => item.id}
        extraData={`${i18n.language}|${theme.highContrast}|${theme.fontScale}`}
        contentContainerStyle={[styles.content, versions.length === 0 && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            {errorKey ? (
              <View style={styles.block}>
                <MessageBanner message={t(errorKey)} tone="danger" />
              </View>
            ) : null}

            {canConfigure ? (
              <AppButton
                title={t("policy.newVersion")}
                onPress={() => navigation.navigate("NewPolicyVersion")}
                style={styles.block}
              />
            ) : (
              /* Said plainly rather than shown as a disabled button. A supervisor is not being
                 denied something they were offered — this was never theirs to do. */
              <AppText variant="caption" tone="secondary" style={styles.block}>
                {t("policy.readOnlyNotice")}
              </AppText>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <AppText variant="subtitle">{t("policy.emptyTitle")}</AppText>
            <AppText variant="body" tone="secondary" style={styles.emptyBody}>
              {t("policy.emptyBody")}
            </AppText>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityRole="button"
            onPress={() => navigation.navigate("PolicyVersionDetail", { versionId: item.id })}
            style={[
              styles.card,
              cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
              {
                borderRadius: theme.metrics.radius,
                backgroundColor: theme.colors.surface,
                // The version in force gets the emphasis. Everything else is history.
                borderColor: item.status === "ACTIVE" ? theme.colors.success : theme.colors.border,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <AppText variant="subtitle" style={styles.cardTitle}>
                {item.versionLabel}
              </AppText>
              <PolicyStatusPill status={item.status} />
            </View>

            <AppText variant="caption" tone="secondary" style={styles.cardMeta}>
              {t("policy.effectiveFrom", { date: formatDate(item.effectiveDate, i18n.language) })}
            </AppText>

            {/* The source, not the thresholds. Which document a version came from is what
                distinguishes two revisions at a glance; the numbers need the detail screen. */}
            <AppText variant="caption" numberOfLines={2} style={styles.cardSource}>
              {item.source}
            </AppText>
          </TouchableOpacity>
        )}
      />
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(12),
  },
  contentEmpty: {
    flexGrow: 1,
  },
  block: {
    marginBottom: vs(12),
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: sharedPaddingHorizontal,
    paddingTop: vs(40),
  },
  emptyBody: {
    marginTop: vs(6),
    textAlign: "center",
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
  cardMeta: {
    marginTop: vs(6),
  },
  cardSource: {
    marginTop: vs(4),
  },
});
