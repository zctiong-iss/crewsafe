/**
 * The supervisor's shift list (SCRUM-161).
 *
 * Runs against the real API — `ShiftController` implements every call this screen makes.
 * Only `mock` auth mode substitutes fixtures, and only for want of a backend.
 *
 * ── ORDER COMES FROM THE SERVER ─────────────────────────────────────────────────────────
 * The contract says most recently created first, and the response carries no `createdAt` —
 * so the client could not reproduce that order even if it wanted to. Sorting here by start
 * time would look tidier and would be wrong: it would silently disagree with the web console
 * and with every other consumer of the same endpoint.
 *
 * @author Justin Chua
 */
import { useCallback } from "react";
import { FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppLoader from "@/components/feedback/AppLoader";
import AppSwitch from "@/components/inputs/AppSwitch";
import MessageBanner from "@/components/feedback/MessageBanner";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";
import ShiftStatusPill from "@/components/shifts/ShiftStatusPill";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loadShifts, siteSelected } from "@/store/reducers/shiftsSlice";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { isMockApi } from "@/auth/authMode";
import { getForceForbidden, setForceForbidden } from "@/api/mock/shifts";
import { formatDateTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { ShiftsStackParamList } from "@/navigation/types";

export default function ShiftListScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<ShiftsStackParamList>>();

  const user = useAppSelector((state) => state.auth.user);
  const { status, sites, selectedSiteId, shifts, errorKey, requestId, refreshing } =
    useAppSelector((state) => state.shifts);

  const load = useCallback(
    (isRefresh: boolean, siteId?: string) => {
      if (!user) return;
      void dispatch(loadShifts({ siteIds: user.siteIds, siteId, refreshing: isRefresh }));
    },
    [dispatch, user],
  );

  // A shift list changes when a supervisor plans one, which is a human-speed event — the
  // shift interval is frequent enough and costs little.
  useAutoRefresh(
    useCallback(() => load(false, selectedSiteId ?? undefined), [load, selectedSiteId]),
    REFRESH_INTERVALS.SHIFT_MS,
  );

  if (status === "loading") {
    return (
      <AppSafeView>
        <AppLoader fullscreen message={t("common.loading")} />
      </AppSafeView>
    );
  }

  const header = (
    <View>
      {status === "error" ? (
        <View style={styles.block}>
          {/*
           * The 403 the story calls out lands here. It renders as an explanation and the
           * user stays signed in — only a 401 ends a session. A supervisor whose membership
           * was revoked mid-shift should be told, not ejected.
           */}
          <MessageBanner
            message={t(errorKey ?? "errors.unknown")}
            tone="danger"
            requestId={requestId}
          />
          <AppButton title={t("common.retry")} onPress={() => load(false)} style={styles.gap} />
        </View>
      ) : null}

      {sites.length > 1 ? (
        <View style={styles.block} accessibilityRole="radiogroup">
          <AppText variant="label" style={styles.sectionLabel}>
            {t("shifts.site")}
          </AppText>
          {sites.map((site) => (
            <RadioWithTitle
              key={site.id}
              title={site.name}
              selected={site.id === selectedSiteId}
              onPress={() => {
                // Selection moves first, then the fetch. The slice drops any response
                // whose site no longer matches this, so a slow answer for the previous
                // site cannot overwrite the one being asked for now.
                dispatch(siteSelected(site.id));
                load(true, site.id);
              }}
            />
          ))}
        </View>
      ) : null}

      {selectedSiteId ? (
        <AppButton
          title={t("shifts.createButton")}
          onPress={() => navigation.navigate("CreateShift", { siteId: selectedSiteId })}
          icon={<Ionicons name="add" size={s(18)} color={theme.colors.onPrimary} />}
          style={styles.block}
        />
      ) : null}
    </View>
  );

  const empty =
    status === "ready" ? (
      <View style={styles.empty}>
        <AppText variant="title" style={styles.centre}>
          {sites.length === 0 ? t("shifts.noSitesTitle") : t("shifts.emptyTitle")}
        </AppText>
        <AppText variant="body" tone="secondary" style={[styles.centre, styles.gap]}>
          {sites.length === 0 ? t("shifts.noSitesBody") : t("shifts.emptyBody")}
        </AppText>
      </View>
    ) : null;

  const footer =
    __DEV__ && isMockApi() ? (
      <View
        style={[
          styles.devPanel,
          { borderTopColor: theme.colors.border, borderTopWidth: theme.metrics.borderWidth },
        ]}
      >
        <AppSwitch
          label={t("dev.forbiddenLabel")}
          hint={t("dev.forbiddenHint")}
          value={getForceForbidden()}
          onValueChange={(value) => {
            setForceForbidden(value);
            load(true, selectedSiteId ?? undefined);
          }}
        />
      </View>
    ) : null;

  return (
    <AppSafeView>
      <FlatList
        data={shifts}
        keyExtractor={(item) => item.id}
        /*
         * `data` covers everything the server sends — the slice replaces the array on every
         * load and filters it on delete, so rows update without a reload.
         *
         * `extraData` covers what rows read from *outside* `data`. FlatList is a
         * PureComponent: without this it has no way to know that a language switch or the
         * high-contrast toggle changed what a row should render, and the list would keep
         * showing the old language until something else forced it to re-render. A compact
         * string rather than an object so the shallow compare actually short-circuits when
         * nothing relevant changed.
         */
        extraData={`${i18n.language}|${theme.highContrast}|${theme.fontScale}`}
        contentContainerStyle={[styles.content, shifts.length === 0 && styles.contentEmpty]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true, selectedSiteId ?? undefined)}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.7}
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate("ShiftDetail", { siteId: item.siteId, shiftId: item.id })
            }
            style={[
              styles.card,
              cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
              { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
            ]}
          >
            <View style={styles.cardHeader}>
              {/* flex:1 so a long localised date wraps rather than displacing the pill. */}
              <AppText variant="subtitle" style={styles.cardTitle}>
                {t("shifts.window", {
                  start: formatDateTime(item.startsAt, i18n.language),
                  end: formatDateTime(item.endsAt, i18n.language),
                })}
              </AppText>
              <ShiftStatusPill status={item.status} />
            </View>

            <AppText variant="caption" tone="secondary" style={styles.cardMeta}>
              {item.assignments.length === 0
                ? t("shifts.unstaffed")
                : t("shifts.assignmentCount", { count: item.assignments.length })}
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
  gap: {
    marginTop: vs(8),
  },
  sectionLabel: {
    marginBottom: vs(4),
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
    marginTop: vs(8),
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(48),
  },
  centre: {
    textAlign: "center",
  },
  devPanel: {
    marginTop: vs(20),
    paddingTop: vs(12),
  },
});
