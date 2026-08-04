/**
 * The WBGT reading and its band.
 *
 * Always rendered *below* the lightning banner — FR-12a is explicit that the lightning
 * warning sits above the WBGT reading, and §7.1 evaluates lightning before any WBGT rule.
 * The ordering is enforced by the screen, not by this component; this one only refuses to
 * invent a reading it does not have.
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import FreshnessBadge from "./FreshnessBadge";
import { useTheme } from "@/theme/ThemeProvider";
import { cardSurface } from "@/styles/sharedStyles";
import { formatTime } from "@/helpers/dateTime";
import type { PolicyEvaluation, SiteConditions } from "@/types/domain";

interface WbgtCardProps {
  conditions: SiteConditions;
  policy: PolicyEvaluation | null;
  locale: string;
  /** Dims the card while a stop-work is in force, so the heat plan reads as superseded. */
  superseded?: boolean;
}

const WbgtCard: FC<WbgtCardProps> = ({ conditions, policy, locale, superseded = false }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const secondary = [
    { label: t("wbgt.temperature"), value: conditions.temperature, unit: "°C" },
    { label: t("wbgt.humidity"), value: conditions.humidity, unit: "%" },
    { label: t("wbgt.wind"), value: conditions.windSpeed, unit: " km/h" },
  ];

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        {
          borderRadius: theme.metrics.radius,
          backgroundColor: theme.colors.surface,
          /*
           * Dimming rather than hiding: the reading is still true, it is just no longer
           * what the worker should be acting on.
           *
           * Never in high contrast, though. At 45% opacity black-on-white falls to roughly
           * 3.5:1 — under AA — so the dim would defeat the exact mode a worker turned on to
           * read the screen in sunlight. There the superseded label below carries the
           * meaning on its own, which is why that label exists in both modes rather than
           * the dim being the only signal.
           */
          opacity: superseded && !theme.highContrast ? 0.45 : 1,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <AppText variant="subtitle" style={styles.flexTitle}>
          {t("wbgt.title")}
        </AppText>
        <FreshnessBadge status={conditions.qualityStatus} />
      </View>

      {/* Stated, not implied. A dimmed card reads as "loading" as easily as "superseded",
          and in high contrast there is no dim at all. */}
      {superseded ? (
        <AppText variant="label" tone="danger" style={styles.superseded}>
          {t("wbgt.superseded")}
        </AppText>
      ) : null}

      {conditions.wbgt === null ? (
        <AppText variant="body" tone="secondary" style={styles.reading}>
          {t("wbgt.noReading")}
        </AppText>
      ) : (
        <>
          <View style={styles.readingRow}>
            <AppText variant="display">{conditions.wbgt.toFixed(1)}</AppText>
            <AppText variant="subtitle" tone="secondary" style={styles.unit}>
              °C {t("wbgt.reading")}
            </AppText>
          </View>

          {policy ? (
            <>
              <AppText variant="body" style={styles.band}>
                {t(`wbgt.band.${policy.currentBand}`)}
              </AppText>
              {policy.forecastBand ? (
                <AppText variant="caption" tone="secondary">
                  {t("wbgt.forecast", { band: t(`wbgt.band.${policy.forecastBand}`) })}
                </AppText>
              ) : null}
            </>
          ) : null}
        </>
      )}

      <View style={styles.secondaryRow}>
        {secondary.map((item) =>
          item.value === null ? null : (
            <View key={item.label} style={styles.secondaryItem}>
              <AppText variant="caption" tone="secondary">
                {item.label}
              </AppText>
              <AppText variant="label">{`${item.value}${item.unit}`}</AppText>
            </View>
          ),
        )}
      </View>

      <AppText variant="caption" tone="secondary" style={styles.observed}>
        {t("wbgt.observedAt", { time: formatTime(conditions.observedAt, locale) })}
      </AppText>
    </View>
  );
};

export default WbgtCard;

const styles = StyleSheet.create({
  card: {
    padding: s(14),
    marginTop: vs(12),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  flexTitle: {
    flexShrink: 1,
    marginEnd: s(8),
  },
  superseded: {
    marginTop: vs(6),
  },
  readingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    marginTop: vs(6),
  },
  unit: {
    marginStart: s(6),
  },
  reading: {
    marginTop: vs(8),
  },
  band: {
    marginTop: vs(2),
  },
  secondaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: vs(12),
  },
  secondaryItem: {
    marginEnd: s(20),
    marginTop: vs(4),
  },
  observed: {
    marginTop: vs(10),
  },
});
