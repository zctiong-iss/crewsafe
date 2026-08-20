/**
 * The trained-model WBGT forecast for a site, at 30 and 60 minutes (SCRUM-365 / US-06).
 *
 * ── WHAT THIS SCREEN IS CAREFUL ABOUT ───────────────────────────────────────────────────
 * A forecast that looks like a measurement is worse than no forecast, because it borrows the
 * authority of a thermometer. Three things keep them apart here: the horizon is stated on
 * every value, the interval is rendered beside every point estimate rather than behind a
 * disclosure, and the model version and generation time are on screen rather than in a log.
 *
 * The interval is not decoration and is never omitted. A model that is unsure must *look*
 * unsure — a bare number at one decimal place reads as precision the prediction does not
 * have, and this is a screen someone may move a crew on.
 *
 * ── WHY THERE IS NO BAND HERE ───────────────────────────────────────────────────────────
 * `SiteForecast` carries a predicted value and no band, and none is derived on the device.
 * FR-15 and §12.2 make the server authoritative for whether a number means rest; a client
 * that computed Green/Amber/Red from `predictedValue` would diverge silently the moment a
 * Safety Manager versions the policy (SCRUM-120) and would keep showing the superseded
 * verdict with full confidence. SCRUM-369 adds the evaluated band server-side. Until it
 * lands, degrees and interval is the honest rendering — not a degraded one — and the screen
 * says so rather than leaving the absence to be read as a bug.
 *
 * ── WHY UNAVAILABLE IS QUIET ────────────────────────────────────────────────────────────
 * `SiteForecastService` declines on seven ordinary conditions, several of which (stale or
 * simulated weather, a gap off the 15-minute cadence) are routine. That state gets an
 * explanation, not an error banner. Only a genuine failure gets the banner, which is what
 * keeps the banner worth reading.
 *
 * @author Justin Chua
 */
import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { RouteProp } from "@react-navigation/native";
import { useRoute } from "@react-navigation/native";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  FORECAST_HORIZONS,
  forecastSiteChanged,
  loadForecast,
  type HorizonState,
} from "@/store/reducers/forecastSlice";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { formatTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import { wbgtBandColor } from "@/helpers/wbgtBandColor";
import type { ForecastHorizonMinutes } from "@/types/domain";
import type { WeatherStackParamList } from "@/navigation/types";

type ReadyForecast = NonNullable<HorizonState["forecast"]>;

export default function ForecastScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const { siteId } = useRoute<RouteProp<WeatherStackParamList, "Forecast">>().params;

  const { horizons, refreshing } = useAppSelector((state) => state.forecast);

  const load = useCallback(
    (isRefresh: boolean) => {
      // Points the slice at this route's site first, so anything held for another one is
      // discarded before a single number is drawn under this site's name.
      dispatch(forecastSiteChanged(siteId));
      FORECAST_HORIZONS.forEach((horizonMinutes) => {
        void dispatch(loadForecast({ siteId, horizonMinutes, refreshing: isRefresh }));
      });
    },
    [dispatch, siteId],
  );

  // Fires on focus and on resume as well as on an interval — a forecast left on screen while
  // the phone was in a pocket is the one most likely to have expired.
  useAutoRefresh(
    useCallback(() => load(false), [load]),
    REFRESH_INTERVALS.WEATHER_MS,
  );

  return (
    <AppSafeView>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        <AppText variant="body" tone="secondary">
          {t("forecast.intro")}
        </AppText>

        {FORECAST_HORIZONS.map((horizonMinutes) => (
          <HorizonCard
            key={horizonMinutes}
            horizonMinutes={horizonMinutes}
            state={horizons[horizonMinutes]}
            onRetry={() => load(false)}
          />
        ))}

        {/* The note explaining why no band was shown is gone along with the reason for it:
            SCRUM-369 means a forecast now carries one. A card whose band the server did not
            classify still renders plainly, which is the honest reading of that absence. */}
      </ScrollView>
    </AppSafeView>
  );
}

function HorizonCard({
  horizonMinutes,
  state,
  onRetry,
}: Readonly<{
  horizonMinutes: ForecastHorizonMinutes;
  state: HorizonState;
  onRetry: () => void;
}>) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
      ]}
    >
      <AppText variant="label">{t("forecast.horizon", { count: horizonMinutes })}</AppText>
      <HorizonContent state={state} onRetry={onRetry} />
    </View>
  );
}

function HorizonContent({ state, onRetry }: Readonly<{ state: HorizonState; onRetry: () => void }>) {
  const { t } = useTranslation();

  if (state.status === "loading" || state.status === "idle") {
    return (
      <View style={styles.cardBody}>
        <AppLoader message={t("common.loading")} />
      </View>
    );
  }
  if (state.status === "ready") {
    return state.forecast ? <ForecastReading forecast={state.forecast} /> : null;
  }
  if (state.status === "unavailable") {
    return (
      <View style={styles.cardBody}>
        <AppText variant="subtitle">{t("forecast.unavailableTitle")}</AppText>
        <AppText variant="body" tone="secondary" style={styles.unavailableBody}>
          {t("forecast.unavailableBody")}
        </AppText>
      </View>
    );
  }
  return (
    <View style={styles.cardBody}>
      <MessageBanner
        message={t(state.errorKey ?? "errors.unknown")}
        tone="danger"
        requestId={state.requestId}
      />
      <AppButton title={t("common.retry")} onPress={onRetry} style={styles.retry} />
    </View>
  );
}

function ForecastReading({ forecast }: Readonly<{ forecast: ReadyForecast }>) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const bandColor = wbgtBandColor(forecast.band, theme.colors);
  const lowerBandColor = wbgtBandColor(forecast.confidenceIntervalLowerBand, theme.colors);
  const upperBandColor = wbgtBandColor(forecast.confidenceIntervalUpperBand, theme.colors);

  return (
    <View style={styles.cardBody}>
      <View style={styles.valueRow}>
        <AppText variant="display" style={bandColor ? { color: bandColor } : undefined}>
          {forecast.predictedValue.toFixed(1)}
        </AppText>
        <AppText
          variant="subtitle"
          tone={bandColor ? undefined : "secondary"}
          style={[styles.unit, bandColor ? { color: bandColor } : null]}
        >
          °C
        </AppText>
      </View>

      {forecast.band ? (
        <AppText
          variant="label"
          style={[styles.bandLabel, bandColor ? { color: bandColor } : undefined]}
        >
          {t(`wbgt.band.${forecast.band}`)}
        </AppText>
      ) : null}

      <AppText variant="caption" tone="secondary">
        {t("forecast.rangeLabel")}
      </AppText>
      <AppText
        variant="subtitle"
        accessibilityLabel={t("forecast.range", {
          lower: forecast.confidenceIntervalLower.toFixed(1),
          upper: forecast.confidenceIntervalUpper.toFixed(1),
        })}
      >
        <AppText variant="subtitle" style={lowerBandColor ? { color: lowerBandColor } : undefined}>
          {forecast.confidenceIntervalLower.toFixed(1)}
        </AppText>
        {t("forecast.rangeSeparator")}
        <AppText variant="subtitle" style={upperBandColor ? { color: upperBandColor } : undefined}>
          {forecast.confidenceIntervalUpper.toFixed(1)}
        </AppText>
        <AppText variant="subtitle" style={upperBandColor ? { color: upperBandColor } : undefined}>
          {t("forecast.rangeUnit")}
        </AppText>
      </AppText>

      <ForecastBasisNote forecast={forecast} />

      <View style={styles.provenance}>
        <AppText variant="caption" tone="secondary" style={styles.metaItem}>
          {t("forecast.model", { version: forecast.modelVersion })}
        </AppText>
        <AppText variant="caption" tone="secondary" style={styles.metaItem}>
          {t("forecast.generatedAt", {
            time: formatTime(forecast.generatedAt, i18n.language),
          })}
        </AppText>
      </View>
    </View>
  );
}

function ForecastBasisNote({ forecast }: Readonly<{ forecast: ReadyForecast }>) {
  const { t } = useTranslation();
  if (!forecast.degraded || !forecast.basis || forecast.basis === "MODEL") return null;

  return (
    <View style={styles.basisNote}>
      <AppText variant="caption">{t(`forecast.basisNote.${forecast.basis}`)}</AppText>
      {typeof forecast.inputAgeMinutes === "number" ? (
        <AppText variant="caption" tone="secondary" style={styles.metaItem}>
          {t("forecast.inputAge", { count: forecast.inputAgeMinutes })}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(12),
  },
  card: {
    padding: s(16),
    marginTop: vs(12),
  },
  cardBody: {
    marginTop: vs(8),
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    // Wraps rather than clips once the text setting makes the pair too wide.
    flexWrap: "wrap",
    marginBottom: vs(6),
  },
  bandLabel: {
    marginTop: vs(2),
    marginBottom: vs(8),
  },
  unit: {
    marginStart: s(4),
  },
  basisNote: {
    marginTop: vs(10),
  },
  provenance: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: vs(12),
  },
  metaItem: {
    marginEnd: s(14),
    marginTop: vs(2),
  },
  unavailableBody: {
    marginTop: vs(6),
  },
  retry: {
    marginTop: vs(12),
  },
  footnote: {
    marginTop: vs(20),
  },
});
