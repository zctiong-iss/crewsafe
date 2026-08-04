/**
 * The WBGT reading, and nothing else.
 *
 * Always rendered *below* the lightning banner — FR-12a is explicit that the lightning
 * warning sits above the WBGT reading, and §7.1 evaluates lightning before any WBGT rule.
 * The ordering is enforced by the screen, not by this component; this one only refuses to
 * invent a reading it does not have.
 *
 * ── WHY THIS CARD IS NOW ONE NUMBER ─────────────────────────────────────────────────────
 * It previously carried the band ("32 to 33°C"), the next-hour forecast, air temperature,
 * humidity, wind and the observation time. All of it was true and none of it was actionable
 * on a phone held at arm's length in sun: the worker's decision is driven by the actions in
 * the heat plan, not by reading a band boundary off a card. Stripped to the reading at the
 * product owner's request.
 *
 * What was removed is not lost — `SiteConditions` still carries every field, and the
 * Weather tab renders the full picture for anyone who wants it. This is a display decision,
 * not a data one.
 *
 * ── THE READING IS THE SERVER'S, ALWAYS ─────────────────────────────────────────────────
 * `conditions.wbgt` is whatever the API returned. In mock mode that is a fixture; once
 * `GET /api/v1/sites/{siteId}/conditions` exists it is the NEA-ingested observation with no
 * change to this file. Nothing here derives, rounds toward, or falls back to a number of
 * its own — §12.2 is explicit that no client may compute or override a WBGT band, and a
 * "sensible default" here would be exactly that with a friendlier name.
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import FreshnessBadge from "./FreshnessBadge";
import { useTheme } from "@/theme/ThemeProvider";
import { cardSurface } from "@/styles/sharedStyles";
import type { SiteConditions } from "@/types/domain";

interface WbgtCardProps {
  conditions: SiteConditions;
  /** Dims the card while a stop-work is in force, so the heat plan reads as superseded. */
  superseded?: boolean;
}

const WbgtCard: FC<WbgtCardProps> = ({ conditions, superseded = false }) => {
  const { t } = useTranslation();
  const theme = useTheme();

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

      {/*
        Stated, not implied. A dimmed card reads as "loading" as easily as "superseded", and
        in high contrast there is no dim at all.

        This label matters more than it did: with the heat plan card switched off (see
        `features.heatGuidanceCard`) it is now the *only* place the app says in words that a
        lightning stop-work overrides the heat guidance, which FR-12a requires.
      */}
      {superseded ? (
        <AppText variant="label" tone="danger" style={styles.superseded}>
          {t("wbgt.superseded")}
        </AppText>
      ) : null}

      {conditions.wbgt === null ? (
        // Says so rather than showing a dash. A missing reading and a reading of zero must
        // never look alike on a heat-safety screen.
        <AppText variant="body" tone="secondary" style={styles.reading}>
          {t("wbgt.noReading")}
        </AppText>
      ) : (
        <View style={styles.readingRow}>
          <AppText variant="display">{conditions.wbgt.toFixed(1)}</AppText>
          <AppText variant="subtitle" tone="secondary" style={styles.unit}>
            °C {t("wbgt.reading")}
          </AppText>
        </View>
      )}
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
});
