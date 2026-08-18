/**
 * The 30-minute forecast, as an entry point on the weather screen (SCRUM-366 / US-06).
 *
 * ── WHY IT LIVES HERE RATHER THAN IN A TAB ──────────────────────────────────────────────
 * "What is it now?" and "what is it about to be?" are one question, and a supervisor already
 * comes to the weather screen to ask the first half. A separate tab would split them and make
 * the second half something you have to know to go looking for.
 *
 * ── WHY IT IS SMALL ─────────────────────────────────────────────────────────────────────
 * It sits below the hero and reads at caption weight on purpose. The measured WBGT is what
 * the weather screen is for. A prediction rendered at equal weight beside a thermometer
 * invites someone to act on the forecast as though it had been observed — and the interval,
 * which is the thing that makes a forecast honest, does not fit at this size, so the card
 * shows only the estimate and sends the reader to the full screen for the rest.
 *
 * ── DEGRADING ───────────────────────────────────────────────────────────────────────────
 * A declined forecast collapses to one explanatory line and nothing else on the weather
 * screen changes. A genuine failure also stays to one line here rather than raising a second
 * banner over a screen that may already be showing one; the banner, the request id and the
 * retry live on the forecast screen, which this card still opens.
 *
 * @author Justin Chua
 */
import { useCallback } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { forecastSiteChanged, loadForecast } from "@/store/reducers/forecastSlice";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import { wbgtBandColor } from "@/helpers/wbgtBandColor";
import type { WeatherStackParamList } from "@/navigation/types";

/** The card previews the nearer horizon only; the screen behind it shows both. */
const PREVIEW_HORIZON = 30 as const;

export default function ForecastCard({ siteId }: { siteId: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<WeatherStackParamList>>();

  const state = useAppSelector((root) => root.forecast.horizons[PREVIEW_HORIZON]);

  useAutoRefresh(
    useCallback(() => {
      dispatch(forecastSiteChanged(siteId));
      void dispatch(loadForecast({ siteId, horizonMinutes: PREVIEW_HORIZON }));
    }, [dispatch, siteId]),
    REFRESH_INTERVALS.WEATHER_MS,
  );

  const summary =
    state.status === "ready" && state.forecast
      ? t("forecast.cardValue", {
          value: state.forecast.predictedValue.toFixed(1),
          count: PREVIEW_HORIZON,
        })
      : state.status === "unavailable"
        ? t("forecast.cardUnavailable")
        : state.status === "error"
          ? t("forecast.cardError")
          : t("common.loading");

  /*
   * The band's colour, from the band the server evaluated (SCRUM-369). Applied to the summary
   * line rather than a separate label: this card deliberately shows no interval and no band
   * text for space, so the colour is a hint that the full reading is one tap away — the screen
   * behind it is where the band is stated in words.
   */
  const bandColor =
    state.status === "ready" ? wbgtBandColor(state.forecast?.band, theme.colors) : null;

  // Only the server decides this. `degraded` is authoritative; `basis` names which fallback.
  const basis = state.status === "ready" ? state.forecast?.basis : undefined;
  const degradedTag =
    state.status === "ready" && state.forecast?.degraded && basis && basis !== "MODEL"
      ? t(`forecast.basisTag.${basis}`)
      : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("forecast.cardAccessibilityLabel")}
      onPress={() => navigation.navigate("Forecast", { siteId })}
      style={({ pressed }) => [
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        {
          borderRadius: theme.metrics.radius,
          backgroundColor: theme.colors.surface,
          // Opacity only, no transform: this is feedback on a tap, not motion, so it needs no
          // Reduce Motion branch.
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.text}>
          <AppText variant="label">{t("forecast.cardTitle")}</AppText>
          <AppText
            variant="body"
            tone="secondary"
            style={[styles.summary, bandColor ? { color: bandColor } : undefined]}
          >
            {summary}
          </AppText>
          {/*
            A degraded forecast is labelled even at this size. The card deliberately omits the
            interval for space, which means a fallback value would otherwise appear here as a
            bare number indistinguishable from a model prediction — the one thing the ladder
            must never allow. The tag is short enough to fit where the range is not.
          */}
          {degradedTag ? (
            <AppText variant="caption" tone="secondary" style={styles.tag}>
              {degradedTag}
            </AppText>
          ) : null}
        </View>
        <AppText variant="body" tone="secondary">
          {t("forecast.cardOpen")}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: s(14),
    marginTop: vs(12),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    // Reflows instead of clipping the chevron text once the text setting grows the label.
    flexWrap: "wrap",
  },
  text: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: s(180),
  },
  summary: {
    marginTop: vs(2),
  },
  tag: {
    marginTop: vs(2),
  },
});
