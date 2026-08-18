/**
 * The freshness pill and the button that explains it, side by side.
 *
 * ── WHY THESE TWO ARE ONE COMPONENT ─────────────────────────────────────────────────────
 * They were composed inline on `WeatherScreen`, inside a style called `badgeRow` that was not
 * a row. With a single child that is invisible — `column` and `row` lay one item out
 * identically — so the name read as correct for as long as the pill was alone there. The
 * moment the status button joined it, it stacked underneath, because the hero centres its
 * children and a default-direction View is a column.
 *
 * Owning the layout here is what makes that testable. A style property on a screen is
 * asserted by looking at it; a component can be rendered and asked.
 *
 * ── ONE PLACE FOR EVERY CONDITION ───────────────────────────────────────────────────────
 * The pill renders for all four freshness states and the button hides itself on LIVE, so
 * every state that needs an explanation gets the same treatment from the same code —
 * DELAYED, STALE and SIMULATED alike. There is no per-status branch here to fall out of step.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { StyleSheet, View } from "react-native";
import { vs } from "react-native-size-matters";

import FreshnessBadge from "@/components/safety/FreshnessBadge";
import WeatherStatusButton from "./WeatherStatusButton";
import type { WeatherQualityStatus } from "@/types/domain";

/**
 * Identifies the container itself, rather than the text inside it.
 *
 * The same reason `MessageBanner` carries one: the thing worth asserting here is the layout of
 * a View, and there is no accessible text on it to find it by. Walking up from the pill is not
 * a substitute — the pill has its own inner row, so a search for the nearest laid-out ancestor
 * finds that one and passes whatever this container does.
 */
export const WEATHER_STATUS_ROW_TEST_ID = "weather-status-row";

interface WeatherStatusRowProps {
  status: WeatherQualityStatus;
  onExplain: () => void;
}

const WeatherStatusRow: FC<WeatherStatusRowProps> = ({ status, onExplain }) => (
  /* The pill reports, the button explains. Two elements rather than one tappable pill,
     because ADR-0017 keeps pills out of the control role — see `WeatherStatusButton`. */
  <View style={styles.row} testID={WEATHER_STATUS_ROW_TEST_ID}>
    <FreshnessBadge status={status} />
    <WeatherStatusButton subject={status} onPress={onExplain} />
  </View>
);

export default WeatherStatusRow;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    /*
     * Centres the glyph on the pill's optical centre line rather than its top edge. The pill
     * is the taller of the two, and top-aligning them makes the icon look dropped rather than
     * paired with it.
     */
    alignItems: "center",
    marginTop: vs(12),
  },
});
