/**
 * Plans awaiting the supervisor's decision (SCRUM-119 / US-09).
 *
 * ── WHY A LIST ACROSS SHIFTS, WHEN THE ENDPOINT IS PER SHIFT ────────────────────────────
 * A recommendation belongs to a shift, so the API is scoped to one. But the question this screen
 * answers is "what is waiting on me?", which is not a per-shift question — a supervisor running
 * three crews should not have to open three shifts to discover that only one needs them. The
 * slice fans out the per-shift reads and collects the answers; see its class doc for why that
 * N+1 is a deliberate, temporary trade rather than an oversight.
 *
 * ── PENDING FIRST, THEN HISTORY ─────────────────────────────────────────────────────────
 * Decided plans stay on the list rather than vanishing. "Draft and final versions retained" is
 * the acceptance criterion, and a decision that disappears the moment it is made cannot be
 * reviewed — by the supervisor who made it or the safety manager reading over their shoulder.
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
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";
import RecommendationStatusPill from "@/components/recommendations/RecommendationStatusPill";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loadRecommendations } from "@/store/reducers/recommendationsSlice";
import { loadShifts } from "@/store/reducers/shiftsSlice";
import { formatDateTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { RecommendationsStackParamList } from "@/navigation/types";

export default function RecommendationsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<RecommendationsStackParamList>>();

  const user = useAppSelector((state) => state.auth.user);
  const { items, status, errorKey, refreshing } = useAppSelector((state) => state.recommendations);
  const shifts = useAppSelector((state) => state.shifts.shifts);
  const selectedSiteId = useAppSelector((state) => state.shifts.selectedSiteId);

  /*
   * The site comes from the shifts slice, which the Shifts tab already populates. Falling back to
   * the user's first membership means this tab works when opened first, on a cold start, rather
   * than showing an empty state until the supervisor happens to visit Shifts.
   */
  const siteId = selectedSiteId ?? user?.siteIds[0] ?? null;

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!siteId) return;
      // Shifts too: the list renders each recommendation under the shift window it applies to,
      // and that window is not on the recommendation itself.
      void dispatch(loadShifts({ siteIds: user?.siteIds ?? [], siteId, refreshing: isRefresh }));
      void dispatch(loadRecommendations({ siteId, refreshing: isRefresh }));
    },
    [dispatch, siteId, user?.siteIds],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const windowFor = useCallback(
    (shiftId: string) => {
      const shift = shifts.find((item) => item.id === shiftId);
      if (!shift) return null;
      return t("shifts.window", {
        start: formatDateTime(shift.startsAt, i18n.language),
        end: formatDateTime(shift.endsAt, i18n.language),
      });
    },
    [shifts, t, i18n.language],
  );

  if (status === "loading" && items.length === 0) {
    return (
      <AppSafeView>
        <AppLoader />
      </AppSafeView>
    );
  }

  return (
    <AppSafeView>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        /* Rows read the language, the theme and the shift windows — none of which live in
           `data`, and FlatList is a PureComponent. Without this a language switch would leave
           the list in the previous one. */
        extraData={`${i18n.language}|${theme.highContrast}|${theme.fontScale}|${shifts.length}`}
        contentContainerStyle={[styles.content, items.length === 0 && styles.contentEmpty]}
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
          errorKey ? (
            <View style={styles.block}>
              <MessageBanner message={t(errorKey)} tone="danger" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <AppText variant="subtitle">{t("recommendations.emptyTitle")}</AppText>
            <AppText variant="body" tone="secondary" style={styles.emptyBody}>
              {t("recommendations.emptyBody")}
            </AppText>
          </View>
        }
        renderItem={({ item }) => {
          const window = windowFor(item.shiftId);
          return (
            <TouchableOpacity
              activeOpacity={0.7}
              accessibilityRole="button"
              onPress={() =>
                navigation.navigate("RecommendationDetail", {
                  siteId: siteId ?? "",
                  shiftId: item.shiftId,
                  recommendationId: item.id,
                })
              }
              style={[
                styles.card,
                cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
              ]}
            >
              <View style={styles.cardHeader}>
                <AppText variant="subtitle" style={styles.cardTitle}>
                  {window ?? t("recommendations.title")}
                </AppText>
                <RecommendationStatusPill status={item.status} />
              </View>

              {/* The drafted time, not the shift's — a plan drafted an hour ago against a
                  forecast is a different thing from one drafted a minute ago. */}
              <AppText variant="caption" tone="secondary" style={styles.cardMeta}>
                {t("recommendations.draftedAt", {
                  time: formatDateTime(item.createdAt, i18n.language),
                })}
                {" · "}
                {t("recommendations.mitigationCount", { count: item.mitigations.length })}
              </AppText>

              {item.rationale ? (
                <AppText variant="caption" numberOfLines={2} style={styles.cardRationale}>
                  {item.rationale}
                </AppText>
              ) : null}
            </TouchableOpacity>
          );
        }}
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
    justifyContent: "center",
  },
  block: {
    marginBottom: vs(12),
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: sharedPaddingHorizontal,
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
  cardRationale: {
    marginTop: vs(6),
  },
});
