/**
 * NEA-ingested conditions for a site.
 *
 * ── LIVE SINCE SCRUM-209 ────────────────────────────────────────────────────────────────
 * Outside mock mode every number here comes from `GET /api/v1/sites/{siteId}/weather/latest`
 * — the real NEA ingestion, with `source`, `observed_at`, `ingested_at` and `quality_status`
 * as FR-11 requires — and the WBGT band comes down beside it already evaluated. The client
 * does not derive the band (§12.2, FR-15). `GET /api/v1/sites` behind the picker was already
 * real, so this screen no longer has a mock in its path at all outside `mock` auth mode.
 *
 * `api/mock/conditions.ts` still answers in mock mode and is still the contract for the
 * unbuilt `/conditions` endpoint the shift screen needs.
 *
 * ── WHAT THIS SCREEN IS NOT ─────────────────────────────────────────────────────────────
 * It shows the reading and its band. It does not show the required heat actions, and that
 * is deliberate: those depend on the worker's own task intensity and acclimatisation, which
 * this screen does not know and must not guess. They live on the shift screen, where the
 * assignment is. A supervisor reading conditions for a site is not looking at any one
 * worker's obligations.
 *
 * @author Justin Chua
 */
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";
import WeatherIcon from "@/components/weather/WeatherIcon";
import WeatherBackdrop from "@/components/weather/backdrops/WeatherBackdrop";
import ForecastCard from "@/components/weather/ForecastCard";
import FreshnessBadge from "@/components/safety/FreshnessBadge";
import FreshnessNotice from "@/components/safety/FreshnessNotice";

import AppSwitch from "@/components/inputs/AppSwitch";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loadSiteWeatherSummary, loadWeather, siteSelected } from "@/store/reducers/weatherSlice";
import SiteConditionsPicker from "@/components/weather/SiteConditionsPicker";
import { isMockApi } from "@/auth/authMode";
import {
  getNightOverride,
  getWeatherScenario,
  setNightOverride,
  setWeatherScenario,
  type WeatherScenario,
} from "@/api/mock/scenario";
import type { WeatherCondition } from "@/types/domain";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { classifyCondition, isNightObservation } from "@/helpers/weather";
import { formatTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

const WEATHER_SCENARIOS: WeatherScenario[] = [
  "fair",
  "partly-cloudy",
  "cloudy",
  "windy",
  "rain",
  "storm",
];

/** Labels only — the scenario sets metrics, and the classifier decides the real condition. */
const SCENARIO_CONDITION: Record<WeatherScenario, WeatherCondition> = {
  fair: "FAIR",
  "partly-cloudy": "PARTLY_CLOUDY",
  cloudy: "CLOUDY",
  windy: "WINDY",
  rain: "RAIN",
  storm: "THUNDERY_SHOWERS",
};

export default function WeatherScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const {
    status,
    sites,
    selectedSiteId,
    conditions,
    band,
    summaryBySite,
    errorKey,
    requestId,
    refreshing,
  } = useAppSelector((state) => state.weather);

  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(
    (isRefresh: boolean, siteId?: string) => {
      if (!user) return;
      void dispatch(
        loadWeather({ workerId: user.id, siteIds: user.siteIds, siteId, refreshing: isRefresh }),
      );
      // One request covering every site, so the picker can show which one is hot without
      // asking per site. Only worth it when there is more than one to compare.
      if (user.siteIds.length > 1) void dispatch(loadSiteWeatherSummary());
    },
    [dispatch, user],
  );

  // Replaces a mount-only useEffect: also fires on tab focus and on resume from background,
  // then every WEATHER_MS while this screen is in front.
  useAutoRefresh(
    useCallback(() => load(false, selectedSiteId ?? undefined), [load, selectedSiteId]),
    REFRESH_INTERVALS.WEATHER_MS,
  );

  const derived = useMemo(() => {
    if (!conditions) return null;
    return {
      condition: classifyCondition(conditions),
      night: isNightObservation(conditions.observedAt),
    };
  }, [conditions]);

  if (status === "loading") {
    return (
      <AppSafeView>
        <AppLoader fullscreen message={t("common.loading")} />
      </AppSafeView>
    );
  }

  const metrics = conditions
    ? [
        { label: t("weather.airTemp"), value: conditions.temperature, unit: "°C" },
        { label: t("weather.humidity"), value: conditions.humidity, unit: "%" },
        { label: t("weather.wind"), value: conditions.windSpeed, unit: " km/h" },
        { label: t("weather.rainfall"), value: conditions.rainfall, unit: " mm" },
      ]
    : [];

  return (
    <AppSafeView>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true, selectedSiteId ?? undefined)}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {status === "error" ? (
          <View style={styles.block}>
            <MessageBanner
              message={t(errorKey ?? "errors.unknown")}
              tone="danger"
              requestId={requestId}
            />
            <AppButton title={t("common.retry")} onPress={() => load(false)} style={styles.retry} />
          </View>
        ) : null}

        {/* An empty site list is a legitimate answer from SiteController, not a failure —
            a new starter with no memberships is correctly authenticated and correctly sees
            nothing. It gets an explanation rather than an error. */}
        {status === "ready" && sites.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="title" style={styles.centre}>
              {t("weather.noSitesTitle")}
            </AppText>
            <AppText variant="body" tone="secondary" style={[styles.centre, styles.emptyBody]}>
              {t("weather.noSitesBody")}
            </AppText>
          </View>
        ) : null}

        {/* Only when there is a choice to make. A worker on one site should not be asked to
            pick it. */}
        {/*
          A collapsed row rather than a radio list. The list read well for two sites and fails at
          twenty: it fills the screen and pushes the reading a supervisor came for below the
          fold, and it only ever let them pick a site and look, never see which one is hot.
        */}
        {sites.length > 1 ? (
          <View style={styles.block}>
            <AppText variant="label" style={styles.sectionLabel}>
              {t("weather.site")}
            </AppText>
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("weather.changeSite", {
                site: sites.find((site) => site.id === selectedSiteId)?.name ?? "",
              })}
              style={({ pressed }) => [
                styles.sitePicker,
                {
                  minHeight: theme.metrics.minTouchTarget,
                  borderRadius: theme.metrics.radius,
                  borderWidth: theme.metrics.borderWidth,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <AppText variant="body" numberOfLines={1} style={styles.sitePickerName}>
                {sites.find((site) => site.id === selectedSiteId)?.name ?? t("weather.site")}
              </AppText>
              <Ionicons
                name="chevron-down"
                size={s(18)}
                color={theme.colors.textSecondary}
              />
            </Pressable>
          </View>
        ) : null}

        <SiteConditionsPicker
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          sites={sites}
          selectedSiteId={selectedSiteId}
          summaryBySite={summaryBySite}
          onSelect={(siteId) => {
            // Selection first, then the fetch — the slice discards any response whose site no
            // longer matches, so a slow answer cannot land under the wrong site's name.
            dispatch(siteSelected(siteId));
            load(true, siteId);
          }}
        />

        {conditions && derived ? (
          <>
            <View
              style={[
                styles.hero,
                cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
              ]}
            >
              {/* Absolutely positioned behind everything below it, and only on this card —
                  the Heat conditions card on My shift was stripped to a single reading in
                  SCRUM-196, and decoration behind a safety number there would reverse that
                  with no discussion. Draws nothing in high contrast. */}
              <WeatherBackdrop
                condition={derived.condition}
                night={derived.night}
                radius={theme.metrics.radius}
              />

              <WeatherIcon
                condition={derived.condition}
                night={derived.night}
                size={72}
                color={theme.colors.textPrimary}
              />

              <AppText variant="title" style={styles.conditionLabel}>
                {t(`weather.condition.${derived.condition}`)}
              </AppText>

              {sites.length === 1 ? (
                <AppText variant="caption" tone="secondary">
                  {sites[0].name}
                </AppText>
              ) : null}

              <View style={styles.wbgtRow}>
                {/* Deliberately uncoloured. The hero sits on an animated weather backdrop whose
                    tint changes with conditions and time of day, so a semantic colour here has
                    to stay legible against a moving background and competes with it for meaning.
                    Band colour lives on the forecast screen, where the surface is plain. */}
                <AppText variant="display">
                  {conditions.wbgt === null ? "—" : conditions.wbgt.toFixed(1)}
                </AppText>
                <AppText variant="subtitle" tone="secondary" style={styles.unit}>
                  °C
                </AppText>
              </View>

              <AppText variant="caption" tone="secondary" style={styles.centre}>
                {t("weather.feelsLike")}
              </AppText>

              {/* Absent when the reading exists but its WBGT could not be derived. Showing
                  the coolest band instead would turn "unknown" into "safe". */}
              {band ? (
                <AppText variant="label" style={styles.band}>
                  {t(`wbgt.band.${band}`)}
                </AppText>
              ) : null}

              <View style={styles.badgeRow}>
                <FreshnessBadge status={conditions.qualityStatus} />
              </View>
            </View>

            <View style={styles.block}>
              <FreshnessNotice status={conditions.qualityStatus} />
            </View>

            {/* Below the hero and deliberately smaller than it. The measured reading is what
                this screen is for; a prediction shown at equal weight beside a thermometer
                invites someone to act on the forecast as though it were observed. */}
            {selectedSiteId ? <ForecastCard siteId={selectedSiteId} /> : null}

            <View
              style={[
                styles.metricsCard,
                cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
              ]}
            >
              {/* Wrapping row rather than a fixed grid: at 1.5x text these no longer fit
                  two-up and must reflow instead of clipping. */}
              <View style={styles.metricsRow}>
                {metrics.map((metric) => (
                  <View key={metric.label} style={styles.metric}>
                    <AppText variant="caption" tone="secondary">
                      {metric.label}
                    </AppText>
                    <AppText variant="subtitle">
                      {metric.value === null ? "—" : `${metric.value}${metric.unit}`}
                    </AppText>
                  </View>
                ))}
              </View>

              <View style={styles.footerMeta}>
                {conditions.stationId ? (
                  <AppText variant="caption" tone="secondary" style={styles.metaItem}>
                    {t("weather.station", { id: conditions.stationId })}
                  </AppText>
                ) : null}
                <AppText variant="caption" tone="secondary" style={styles.metaItem}>
                  {t("weather.observedAt", { time: formatTime(conditions.observedAt, i18n.language) })}
                </AppText>
                <AppText variant="caption" tone="secondary" style={styles.metaItem}>
                  {t("weather.ingestedAt", { time: formatTime(conditions.ingestedAt, i18n.language) })}
                </AppText>
                {derived.night ? (
                  <AppText variant="caption" tone="secondary" style={styles.metaItem}>
                    {t("weather.night")}
                  </AppText>
                ) : null}
              </View>
            </View>
          </>
        ) : status === "ready" && selectedSiteId !== null ? (
          /*
           * A site with nothing ingested yet. Only reachable live — the mock always has a
           * reading — and previously it rendered an empty screen under a site picker, which
           * reads as a broken app rather than as "no data for this site".
           *
           * `selectedSiteId !== null` is what separates this from the no-memberships case
           * above, which is also conditions-less and would otherwise stack two empty states.
           */
          <View style={styles.empty}>
            <AppText variant="title" style={styles.centre}>
              {t("weather.noReadingTitle")}
            </AppText>
            <AppText variant="body" tone="secondary" style={[styles.centre, styles.emptyBody]}>
              {t("weather.noReadingBody")}
            </AppText>
          </View>
        ) : null}

        {/* Without this only FAIR is reachable — the fixture returns one set of metrics, so
            five of the six animations and the whole night variant would be unreviewable.
            The switcher sets the *numbers*; the condition is still classified from them. */}
        {__DEV__ && isMockApi() ? (
          <View
            style={[
              styles.devPanel,
              { borderTopColor: theme.colors.border, borderTopWidth: theme.metrics.borderWidth },
            ]}
          >
            <AppText variant="caption" tone="secondary">
              {t("dev.weatherLabel")}
            </AppText>
            <AppText variant="caption" tone="secondary" style={styles.devHint}>
              {t("dev.weatherHint")}
            </AppText>

            {WEATHER_SCENARIOS.map((option) => (
              <RadioWithTitle
                key={option}
                title={t(`weather.condition.${SCENARIO_CONDITION[option]}`)}
                selected={option === getWeatherScenario()}
                onPress={() => {
                  setWeatherScenario(option);
                  load(true, selectedSiteId ?? undefined);
                }}
              />
            ))}

            <AppSwitch
              label={t("dev.nightLabel")}
              value={getNightOverride()}
              onValueChange={(value) => {
                setNightOverride(value);
                load(true, selectedSiteId ?? undefined);
              }}
            />
          </View>
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
  block: {
    marginTop: vs(12),
  },
  sitePicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(12),
    paddingVertical: vs(8),
    gap: s(8),
  },
  sitePickerName: {
    // Yields to the chevron rather than pushing it off: site names are free text.
    flexShrink: 1,
  },
  sectionLabel: {
    marginBottom: vs(4),
  },
  retry: {
    marginTop: vs(12),
  },
  hero: {
    alignItems: "center",
    padding: s(18),
    marginTop: vs(12),
    // The backdrop is absolutely filled and its motes travel; without this a drifting cloud
    // leaves the card. `overflow` clips children on both platforms even where a shadow is
    // drawn outside, which is why `cardSurface`'s elevation still shows.
    overflow: "hidden",
  },
  conditionLabel: {
    marginTop: vs(10),
    textAlign: "center",
  },
  wbgtRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: vs(8),
  },
  unit: {
    marginStart: s(4),
  },
  band: {
    marginTop: vs(6),
    textAlign: "center",
  },
  badgeRow: {
    marginTop: vs(12),
  },
  metricsCard: {
    padding: s(14),
    marginTop: vs(12),
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  metric: {
    // Two-up at default scale, one-up when the text setting makes them too wide.
    minWidth: s(130),
    flexGrow: 1,
    marginBottom: vs(12),
  },
  footerMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  metaItem: {
    marginEnd: s(14),
    marginTop: vs(2),
  },
  empty: {
    alignItems: "center",
    paddingVertical: vs(48),
  },
  centre: {
    textAlign: "center",
  },
  emptyBody: {
    marginTop: vs(8),
  },
  devPanel: {
    marginTop: vs(28),
    paddingTop: vs(12),
  },
  devHint: {
    marginBottom: vs(8),
  },
});
