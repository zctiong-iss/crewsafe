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

function horizonPresentation(state: HorizonState) {
  const forecast = state.status === "ready" ? state.forecast : null;
  return {
    forecast,
    loading: state.status === "loading" || state.status === "idle",
    ready: forecast !== null,
    unavailable: state.status === "unavailable",
    failed: state.status === "error",
  };
}

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
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { forecast, loading, unavailable, failed } = horizonPresentation(state);

  // Null when the server sent no band, which renders as ordinary text — never as the coolest
  // band, since an unknown reading shown in green would read as a safe one.
  const bandColor =
    forecast
      ? wbgtBandColor(forecast.band, theme.colors)
      : null;

  // The interval's bounds carry their own bands, so a range crossing 31 or 33 shows it.
  const lowerBandColor =
    forecast
      ? wbgtBandColor(forecast.confidenceIntervalLowerBand, theme.colors)
      : null;
  const upperBandColor =
    forecast
      ? wbgtBandColor(forecast.confidenceIntervalUpperBand, theme.colors)
      : null;

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
      ]}
    >
      <AppText variant="label">{t("forecast.horizon", { count: horizonMinutes })}</AppText>

      {loading ? (
        <View style={styles.cardBody}>
          <AppLoader message={t("common.loading")} />
        </View>
      ) : null}

      {forecast ? (
        <View style={styles.cardBody}>
          {/*
            Coloured by the band MOM's poster uses, so a supervisor who knows that wall chart
            reads the risk level before reading the number. The band comes evaluated from the
            server (SCRUM-369) — the client colours it, it does not decide it.
          */}
          <View style={styles.valueRow}>
            <AppText
              variant="display"
              style={bandColor ? { color: bandColor } : undefined}
            >
              {forecast.predictedValue.toFixed(1)}
            </AppText>
            {/*
              The unit takes the band colour but keeps its smaller size. `tone` is dropped when
              a colour applies, because tone sets a colour of its own and the two would fight —
              the explicit style wins in `AppText`, but leaving `secondary` on would make the
              intent unreadable to the next person.
            */}
            <AppText
              variant="subtitle"
              tone={bandColor ? undefined : "secondary"}
              style={[styles.unit, bandColor ? { color: bandColor } : null]}
            >
              °C
            </AppText>
          </View>

          {/*
            The band in words, directly under the value it describes.

            Not decoration: colour alone fails WCAG 1.4.1, and on site it also fails to sunlight
            flattening hue and to red/green colour-vision deficiency. This is the signal the
            colour is only a shortcut to — and it carries the 31-to-32 versus 32-to-33
            distinction that the poster's single amber column cannot.
          */}
          {forecast.band ? (
            <AppText
              variant="label"
              style={[styles.bandLabel, bandColor ? { color: bandColor } : undefined]}
            >
              {t(`wbgt.band.${forecast.band}`)}
            </AppText>
          ) : null}

          {/* Always present, never behind a tap. The uncertainty is part of the reading. */}
          <AppText variant="caption" tone="secondary">
            {t("forecast.rangeLabel")}
          </AppText>
          {/*
            Each bound in its own band's colour, because an interval routinely crosses a
            boundary — the half-width reaches 4°C — and one colour across the whole range would
            assert it stays in one band while the range itself says it might not. A green lower
            bound beside an amber upper one is the range saying "this could already be in the
            rest-required band", which is the most useful thing it has to tell a supervisor.

            The nested elements are for colour only. `accessibilityLabel` carries the intact
            translated sentence, so a screen reader hears one phrase rather than three
            fragments, and the localised whole is never assembled from parts.
          */}
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
            {/*
              One unit for two bounds, so it follows the hotter end. On a range that crosses a
              boundary the trailing colour then reinforces the stricter band rather than
              softening it — the wrong way round would let an amber upper bound trail off in
              green.
            */}
            <AppText variant="subtitle" style={upperBandColor ? { color: upperBandColor } : undefined}>
              {t("forecast.rangeUnit")}
            </AppText>
          </AppText>

          {/*
            Placed directly under the range and above the provenance, because it explains the
            range rather than describing where the number came from. A supervisor who reads
            only as far as the interval has still been told why it is as wide as it is.

            `degraded` is the server's own verdict; the client never infers trustworthiness
            from a timestamp, for the same reason it does not compute the band.
          */}
          {forecast.degraded && forecast.basis && forecast.basis !== "MODEL" ? (
            <View style={styles.basisNote}>
              <AppText variant="caption">
                {t(`forecast.basisNote.${forecast.basis}`)}
              </AppText>
              {typeof forecast.inputAgeMinutes === "number" ? (
                <AppText variant="caption" tone="secondary" style={styles.metaItem}>
                  {t("forecast.inputAge", { count: forecast.inputAgeMinutes })}
                </AppText>
              ) : null}
            </View>
          ) : null}

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
      ) : null}

      {unavailable ? (
        <View style={styles.cardBody}>
          <AppText variant="subtitle">{t("forecast.unavailableTitle")}</AppText>
          <AppText variant="body" tone="secondary" style={styles.unavailableBody}>
            {t("forecast.unavailableBody")}
          </AppText>
        </View>
      ) : null}

      {failed ? (
        <View style={styles.cardBody}>
          <MessageBanner
            message={t(state.errorKey ?? "errors.unknown")}
            tone="danger"
            requestId={state.requestId}
          />
          <AppButton title={t("common.retry")} onPress={onRetry} style={styles.retry} />
        </View>
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
