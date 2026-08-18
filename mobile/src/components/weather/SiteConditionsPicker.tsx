/**
 * The site chooser, showing each site's current WBGT beside its name.
 *
 * ── WHY IT REPLACED A RADIO LIST ────────────────────────────────────────────────────────
 * The weather screen listed every site as a radio button. That reads well for two and falls
 * apart at twenty: the list fills the screen, the reading a supervisor came for is pushed below
 * the fold, and choosing between sites means remembering which was hot rather than seeing it.
 *
 * So the collapsed control names the current site, and opening it answers the question a manager
 * with twenty sites actually has — *which* of them is hot — instead of only letting them pick
 * one at a time and look.
 *
 * ── THE READING IS THE POINT, NOT DECORATION ────────────────────────────────────────────
 * Each row carries the WBGT and its band, coloured to MOM's chart, so the list is scannable for
 * the hottest site without opening any of them. The band arrives evaluated from the server
 * (§12.2, FR-15) — this component colours it and never derives it, exactly as the weather hero
 * and the forecast screen do.
 *
 * A site with no reading says so. It is never rendered as a cool one: an unknown site shown
 * green is the failure this whole screen family is careful about.
 *
 * ── BUILT TO BE SHARED ──────────────────────────────────────────────────────────────────
 * `ShiftListScreen` and `CreateShiftScreen` carry the same radio list and the same problem at
 * twenty sites. This takes its rows as data and its selection as props, so those screens can
 * adopt it without a rewrite — the conditions column is optional for the ones that do not want
 * it.
 *
 * @author Justin Chua
 */
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import BottomSheet from "@/components/sheets/BottomSheet";
import { useTheme } from "@/theme/ThemeProvider";
import { wbgtBandColor } from "@/helpers/wbgtBandColor";
import type { Site } from "@/types/domain";
import type { SiteWeatherSummary } from "@/api/endpoints/siteWeatherSummary";

interface SiteConditionsPickerProps {
  visible: boolean;
  onClose: () => void;
  sites: Site[];
  selectedSiteId: string | null;
  onSelect: (siteId: string) => void;
  /** Keyed by site id. A site missing from this map renders without a reading, not as a cool one. */
  summaryBySite: Record<string, SiteWeatherSummary>;
}

const SiteConditionsPicker: FC<SiteConditionsPickerProps> = ({
  visible,
  onClose,
  sites,
  selectedSiteId,
  onSelect,
  summaryBySite,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t("weather.siteConditionsTitle")}>
      {/*
        FlatList, not a mapped ScrollView: this exists for the twenty-site case, and that is the
        difference between a sheet that opens and one that stutters on a mid-range phone. Same
        reasoning as the oversight list.
      */}
      <FlatList
        data={sites}
        keyExtractor={(site) => site.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        extraData={`${selectedSiteId}|${Object.keys(summaryBySite).length}`}
        renderItem={({ item }) => {
          const summary = summaryBySite[item.id];
          const bandColor = wbgtBandColor(summary?.band, theme.colors);
          const selected = item.id === selectedSiteId;

          return (
            <Pressable
              onPress={() => {
                onSelect(item.id);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              /* Name and reading in one announcement: hearing "Bishan Park" then "26.7 degrees"
                 as two stops loses which reading belongs to which site. */
              accessibilityLabel={
                summary?.wbgt == null
                  ? t("weather.siteRowNoReading", { site: item.name })
                  : t("weather.siteRowReading", {
                      site: item.name,
                      value: summary.wbgt.toFixed(1),
                      band: t(`wbgt.band.${summary.band}`),
                    })
              }
              style={({ pressed }) => [
                styles.row,
                {
                  minHeight: theme.metrics.minTouchTarget,
                  borderRadius: theme.metrics.radius,
                  borderWidth: theme.metrics.borderWidth,
                  borderColor: selected ? theme.colors.borderStrong : theme.colors.border,
                  // Fill is a second cue in the default theme only — `surfaceAlt` collapses to
                  // `surface` in high contrast, so it carries nothing there. The bar below is
                  // what actually holds the state in both themes.
                  backgroundColor: selected ? theme.colors.surfaceAlt : theme.colors.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {/*
                An accent bar rather than a checkmark, and absolutely positioned so it occupies
                no layout space at all.

                A trailing tick pushed the reading column left on whichever row happened to be
                selected, so the temperatures no longer lined up between rows — on a list whose
                whole job is comparing readings down a column, that is the one thing it must not
                do. Rendered on every row and merely transparent when unselected, so selecting a
                different site cannot reflow anything.

                A bar and not a border colour or a fill, because in high contrast `border` and
                `borderStrong` are both #000000 and `surface` and `surfaceAlt` are both #FFFFFF
                — neither of those changes is visible there. Black against transparent is.
              */}
              <View
                style={[
                  styles.accent,
                  {
                    backgroundColor: selected ? theme.colors.primary : "transparent",
                    borderTopStartRadius: theme.metrics.radius,
                    borderBottomStartRadius: theme.metrics.radius,
                  },
                ]}
              />
              <View style={styles.name}>
                <AppText variant="body" numberOfLines={2}>
                  {item.name}
                </AppText>
              </View>

              <View style={styles.reading}>
                {summary?.wbgt == null ? (
                  <AppText variant="caption" tone="secondary">
                    {t("weather.noReading")}
                  </AppText>
                ) : (
                  <>
                    <AppText
                      variant="subtitle"
                      style={bandColor ? { color: bandColor } : undefined}
                    >
                      {t("weather.degrees", { value: summary.wbgt.toFixed(1) })}
                    </AppText>
                    {/* The band in words as well as colour — WCAG 1.4.1, and hue washes out
                        in direct sun on a site. */}
                    <AppText
                      variant="caption"
                      style={bandColor ? { color: bandColor } : undefined}
                    >
                      {t(`wbgt.band.${summary.band}`)}
                    </AppText>
                  </>
                )}
              </View>

            </Pressable>
          );
        }}
      />
    </BottomSheet>
  );
};

export default SiteConditionsPicker;

const styles = StyleSheet.create({
  list: {
    gap: vs(8),
    paddingBottom: vs(8),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: s(12),
    gap: s(10),
  },
  name: {
    flex: 1,
  },
  reading: {
    alignItems: "flex-end",
  },
  accent: {
    position: "absolute",
    // `start`/`bottom`, not `left`: mirrors correctly under RTL, which Tamil and Bengali do
    // not need but which costs nothing to get right.
    start: 0,
    top: 0,
    bottom: 0,
    width: s(4),
  },
});
