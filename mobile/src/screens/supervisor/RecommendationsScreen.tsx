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
import { useCallback, useEffect, useRef } from "react";
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
import { showToast } from "@/store/reducers/uiSlice";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
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
  const { items, status, errorKey, refreshing, decidingId } = useAppSelector(
    (state) => state.recommendations,
  );
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

  /*
   * ── PLANS ARRIVE ON THEIR OWN NOW (SCRUM-291 / SCRUM-TBD-70) ──────────────────────────
   * The server drafts a plan by itself when a WBGT band or lightning risk state transitions.
   * Before this, the client never found out: the screen fetched once on mount and otherwise
   * waited for a supervisor to pull down. So the auto-trigger worked and nobody saw it until
   * they happened to refresh.
   *
   * Deliberately a poll and not a request to draft. The client must never call
   * `generateRecommendation` on a timer: it is a real 10-20s model call, so N supervisors
   * watching one site would produce N drafts for a single band change, and it would bypass
   * the server-side dedup that makes a new band change SUPERSEDE the open plan rather than
   * stack a second one. The server stays the only thing that decides when to draft.
   */
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const decidingRef = useRef(decidingId);
  decidingRef.current = decidingId;

  useAutoRefresh(
    useCallback(() => {
      /*
       * Not while a decision is in flight.
       *
       * `items` is the FlatList's data and the server returns most-recently-drafted first, so
       * a poll landing mid-decision can reorder the list under a supervisor's thumb — moving a
       * different plan under a press aimed at Approve. Pull-to-refresh is never suppressed:
       * that is the supervisor choosing to refresh, which is a different thing entirely.
       */
      if (decidingRef.current !== null || refreshingRef.current) return;
      load(false);
    }, [load]),
    REFRESH_INTERVALS.PLANS_MS,
  );

  /*
   * Say so when one arrives, rather than letting it appear silently.
   *
   * The auto-trigger fires precisely when conditions changed, which is when a supervisor most
   * needs to notice — and a card quietly materialising in a list is easy to miss. A toast
   * rather than an Alert: this screen is a decision surface, and a modal would interrupt
   * someone mid-judgement to tell them about something less urgent than what they are doing.
   */
  const seenIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (status !== "ready") return;

    // The first ready render seeds the baseline. Without this, opening the tab would announce
    // every plan already on it as though it had just arrived.
    if (seenIds.current === null) {
      seenIds.current = new Set(items.map((item) => item.id));
      return;
    }

    const arrived = items.filter((item) => !seenIds.current!.has(item.id));
    if (arrived.length > 0) {
      seenIds.current = new Set(items.map((item) => item.id));
      /*
       * Two fixed keys rather than a count.
       *
       * `showToast` carries a key and a tone, with no interpolation values — and widening it
       * for this would put a formatting concern into the store for one message. The exact
       * number is on screen anyway; the toast's job is only to say "look up".
       */
      dispatch(
        showToast({
          messageKey:
            arrived.length === 1 ? "recommendations.autoDrafted" : "recommendations.autoDraftedMany",
          tone: "info",
        }),
      );
    }
  }, [items, status, dispatch]);

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
                {/*
                  One line, at `label` rather than `subtitle`. A shift window is two dates and
                  two times, which wrapped at 18pt and pushed the status pill up against the
                  first line — the pill and the window then read as two rows rather than one
                  heading. 14pt fits the usual case on a phone.

                  `numberOfLines` guarantees it: at a large text setting the string ellipsises
                  rather than reflowing, so the row height never changes and the pill stays put.
                  The full window survives in the accessible label, and on the detail screen.
                */}
                <AppText
                  variant="label"
                  numberOfLines={1}
                  accessibilityLabel={window ?? t("recommendations.title")}
                  style={styles.cardTitle}
                >
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
    // Centred, not top-aligned: with a single-line title the two sit on one axis. `flex-start`
    // was right while the title could wrap to two lines and the pill had to hug the first.
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    // Yields to the pill rather than the other way round — the status is short and fixed, the
    // window is long and variable, so the window is the one that should give way.
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
