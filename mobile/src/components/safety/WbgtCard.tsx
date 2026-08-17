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
 *
 * @author Justin Chua
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
  /**
   * Whether a lightning stop-work is in force, which suspends the heat plan.
   *
   * Adds a line of text. It deliberately does **not** change how the card is drawn — see the
   * note above the label.
   */
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
        ── THIS LINE IS THE OVERRIDE. THE CARD IS NOT DIMMED (SCRUM-260) ────────────────────
        FR-12a requires that a stop-work visibly override the heat plan, and with
        `features.heatGuidanceCard` off this is the *only* place the app says so in words.
        Removing or weakening it drops FR-12a, and nothing on screen would look broken
        afterwards — which is why `WbgtCard.test.tsx` asserts it.

        The card used to dim to 45% opacity as well. That is gone. The dim was never the
        mechanism: it was skipped in high contrast precisely because at 45% black-on-white
        falls to about 3.5:1, under AA, and would defeat the mode a worker turned on to read
        the screen in sunlight. The same argument applies to any phone held at arm's length
        in Singapore daylight, which is the ordinary case rather than the accessible one. A
        dimmed card also reads as "loading" as readily as "superseded" — `HeatGuidance` makes
        that point independently — so the dim cost legibility on the reading a worker needs
        while adding an ambiguous signal on top of an unambiguous sentence.

        Wording carries both jobs at once: shelter first is the instruction, heat rules are
        paused is the override. It deliberately does not repeat the banner directly above,
        which already says to seek shelter in much larger type.
      */}
      {superseded ? (
        <AppText variant="label" tone="danger" style={styles.stopWorkOverride}>
          {t("wbgt.stopWorkOverride")}
        </AppText>
      ) : null}

      {conditions.wbgt === null ? (
        // Says so rather than showing a dash. A missing reading and a reading of zero must
        // never look alike on a heat-safety screen.
        <AppText variant="body" tone="secondary" style={styles.reading}>
          {t("wbgt.noReading")}
        </AppText>
      ) : (
        // `accessible` merges the two sibling Text nodes below into one stop for a screen
        // reader — sighted layout still wants the value and its unit as separate nodes for
        // independent sizing, but announced apart they read as two unrelated facts rather
        // than one reading.
        <View
          style={styles.readingRow}
          accessible
          accessibilityLabel={`${conditions.wbgt.toFixed(1)}°C ${t("wbgt.reading")}`}
        >
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
    // No root margin: MyShiftScreen's container owns the gap between stacked cards.
    // A margin here would add to it and reintroduce per-card spacing drift.
    padding: s(14),
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
  stopWorkOverride: {
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
