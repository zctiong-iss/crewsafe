/**
 * The animated condition icon.
 *
 * ── SWAPPING IN A LOTTIEFILES SET ───────────────────────────────────────────────────────
 * This ships Ionicons driven by `AnimatedIcon`, because that is guaranteed to render and
 * matches every other icon in the app. A designed Lottie weather set would look better; the
 * swap is small and confined to this file:
 *
 *   1. Drop the .json files into `src/assets/animations/`.
 *   2. Build a `Record<string, number>` of `require(...)` calls keyed by
 *      `${condition}${night ? "-night" : ""}` — the string this file already computes below.
 *   3. Render a `LottieView` for a hit and fall through to `AnimatedIcon` for a miss, with a
 *      `.web.tsx` sibling as `LottieSpinner` has (lottie-react-native's web entry pulls in a
 *      dependency that breaks the web bundle otherwise).
 *
 * Deliberately no empty stub branch here waiting to be filled in: a placeholder that renders
 * a blank box the moment somebody adds an asset is worse than no branch at all, because it
 * looks like the asset is broken rather than the wiring being unfinished.
 *
 * All-or-nothing is the right granularity — one animated vector beside five font glyphs
 * reads as a mistake rather than a choice.
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { Ionicons } from "@expo/vector-icons";
import AnimatedIcon, { type IconMotion } from "../feedback/AnimatedIcon";
import type { WeatherCondition } from "@/types/domain";

interface WeatherIconProps {
  condition: WeatherCondition;
  night: boolean;
  size: number;
  color: string;
}

type IconSpec = { name: keyof typeof Ionicons.glyphMap; motion: IconMotion };

/**
 * Motion describes the weather rather than decorating it: the sun turns, rain falls, a
 * storm flashes in bursts, wind pushes sideways, cloud drifts. Someone should be able to
 * read the condition from movement alone at arm's length in glare, where the glyph's shape
 * is the first thing to blur.
 */
const DAY: Record<WeatherCondition, IconSpec> = {
  FAIR: { name: "sunny", motion: "rotate" },
  PARTLY_CLOUDY: { name: "partly-sunny", motion: "drift" },
  CLOUDY: { name: "cloudy", motion: "drift" },
  // Ionicons has no wind glyph — a swaying leaf is the closest honest stand-in, and the
  // motion carries most of the meaning.
  WINDY: { name: "leaf", motion: "sway" },
  RAIN: { name: "rainy", motion: "bob" },
  THUNDERY_SHOWERS: { name: "thunderstorm", motion: "flash" },
};

const NIGHT: Partial<Record<WeatherCondition, IconSpec>> = {
  FAIR: { name: "moon", motion: "breathe" },
  PARTLY_CLOUDY: { name: "cloudy-night", motion: "drift" },
  // Rain, wind, cloud and storms look the same after dark; only the clear-sky states have a
  // meaningfully different night form.
};

const WeatherIcon: FC<WeatherIconProps> = ({ condition, night, size, color }) => {
  const spec = (night ? NIGHT[condition] : undefined) ?? DAY[condition];

  return (
    /*
     * A fixed square with room to spare, for two reasons.
     *
     * Rotation sweeps a glyph's corners outside its own box — a square's diagonal is 1.41x
     * its side — so a container sized exactly to the icon can clip the sun mid-turn under
     * any ancestor that clips. The headroom also fixes the layout: without it, swapping
     * between a wide glyph and a narrow one would shift everything below by a few points
     * each time the condition changed.
     */
    <View style={[styles.container, { width: size * 1.4, height: size * 1.4 }]}>
      <AnimatedIcon name={spec.name} size={size} color={color} motion={spec.motion} />
    </View>
  );
};

export default WeatherIcon;

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
});
