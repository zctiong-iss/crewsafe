/**
 * One entry per condition. This file is the swap point.
 *
 * ── HOW TO REPLACE A BACKDROP ───────────────────────────────────────────────────────────
 * Edit the entry. That is the whole procedure — `WeatherBackdrop` reads this map and knows
 * nothing about any individual condition, so no component changes when a backdrop does.
 *
 * To add a night variant, add a `"<CONDITION>-night"` key. To remove a backdrop entirely,
 * delete the key: the card then renders plain, with no empty frame. That fallback is
 * deliberate and is the same reasoning `WeatherIcon` gives for refusing to ship a stub
 * branch — a blank box looks like a broken asset, an absent one looks like a plain card.
 *
 * ── WHY THE COLOURS ARE LITERAL AND NOT FROM THE PALETTE ────────────────────────────────
 * `styles/colors.ts` is a semantic palette: `danger` means stop work, `warning` means
 * advisory. None of that is what a cloud is. Reaching into it for illustration would tie a
 * decorative shape to a safety colour, so that darkening the danger red for contrast would
 * silently restyle the rain. These are illustration colours and they are local to this file.
 *
 * ── WHY NIGHT IS COOLER RATHER THAN DARKER ──────────────────────────────────────────────
 * The obvious night backdrop is a dark one. It cannot be: CrewSafe has no dark palette —
 * both themes put black text on a white surface — so a dark wash behind the WBGT reading
 * would fail AA on the one screen a supervisor reads a temperature from. Night is therefore
 * expressed as *cooler and dimmer in hue*, not darker in luminance, and
 * `backdropContrast.test.ts` holds that line automatically.
 *
 * ── THE ALPHAS ARE A BUDGET ─────────────────────────────────────────────────────────────
 * Every `opacity` here spends from a fixed contrast allowance. Raising one is not a visual
 * tweak; it is a change to whether the card's text passes AA against its own background.
 * `backdropContrast.test.ts` samples the card on a grid, composites every mote whose travel
 * can reach each point, and fails if the darkest point drops any text colour below 4.5:1.
 * That is the "busiest frame" the plan asks for, computed rather than eyed — and it is why
 * `THUNDERY_SHOWERS` below is dimmer than a storm wants to be.
 *
 * @author Justin Chua
 */
import type { WeatherCondition } from "@/types/domain";
import type { BackdropSpec } from "./types";
import { cloud, rain } from "./shapes";

/**
 * Keyed by `${condition}` and optionally `${condition}-night` — the same string
 * `WeatherIcon` already computes from the same two inputs.
 */
export const BACKDROPS: Partial<Record<string, BackdropSpec>> = {
  FAIR: {
    tint: "#7EC8F5",
    tintOpacity: 0.14,
    motes: [
      // The sun sits off the top-right corner, so what shows is the glow rather than a
      // second sun competing with the icon in the middle of the card.
      { x: 92, y: 4, size: 44, color: "#FFC94D", opacity: 0.18, motion: "pulse", duration: 4200 },
      { x: 92, y: 4, size: 26, color: "#FFE9A8", opacity: 0.22, motion: "pulse", duration: 3000, delay: 600 },
      // Low and to the left, clear of the WBGT reading in the centre.
      ...cloud({ x: 16, y: 90, size: 30, opacity: 0.5, duration: 9000 }),
    ],
  },

  "FAIR-night": {
    tint: "#8FA4D8",
    tintOpacity: 0.15,
    motes: [
      { x: 90, y: 8, size: 24, color: "#E8ECFF", opacity: 0.4, motion: "pulse", duration: 5200 },
      // Stars: small, scattered, and each breathing on its own clock so the sky does not
      // blink in unison.
      { x: 22, y: 16, size: 3.4, color: "#FFFFFF", opacity: 0.65, motion: "pulse", duration: 2600 },
      { x: 41, y: 9, size: 2.6, color: "#FFFFFF", opacity: 0.55, motion: "pulse", duration: 3400, delay: 700 },
      { x: 63, y: 21, size: 3, color: "#FFFFFF", opacity: 0.5, motion: "pulse", duration: 3000, delay: 1400 },
      { x: 11, y: 46, size: 2.4, color: "#FFFFFF", opacity: 0.45, motion: "pulse", duration: 3800, delay: 2100 },
      { x: 88, y: 62, size: 2.8, color: "#FFFFFF", opacity: 0.5, motion: "pulse", duration: 3200, delay: 900 },
      { x: 30, y: 88, size: 2.4, color: "#FFFFFF", opacity: 0.42, motion: "pulse", duration: 4200, delay: 1700 },
    ],
  },

  PARTLY_CLOUDY: {
    tint: "#93CFF0",
    tintOpacity: 0.13,
    motes: [
      { x: 88, y: 8, size: 30, color: "#FFD873", opacity: 0.18, motion: "pulse", duration: 4600 },
      ...cloud({ x: 22, y: 18, size: 34, opacity: 0.5, duration: 8200 }),
      ...cloud({ x: 76, y: 86, size: 28, opacity: 0.42, duration: 11000, delay: 1200 }),
    ],
  },

  "PARTLY_CLOUDY-night": {
    tint: "#93A6CE",
    tintOpacity: 0.16,
    motes: [
      { x: 88, y: 8, size: 22, color: "#E8ECFF", opacity: 0.36, motion: "pulse", duration: 5000 },
      { x: 55, y: 6, size: 2.6, color: "#FFFFFF", opacity: 0.5, motion: "pulse", duration: 3100 },
      ...cloud({ x: 24, y: 20, size: 34, opacity: 0.4, duration: 8200 }),
      ...cloud({ x: 74, y: 86, size: 28, opacity: 0.32, duration: 11000, delay: 1200 }),
    ],
  },

  CLOUDY: {
    tint: "#A8B6C2",
    tintOpacity: 0.16,
    motes: [
      ...cloud({ x: 18, y: 14, size: 36, opacity: 0.5, duration: 9000 }),
      ...cloud({ x: 80, y: 40, size: 30, opacity: 0.4, duration: 12000, delay: 900 }),
      ...cloud({ x: 42, y: 92, size: 40, opacity: 0.36, duration: 10500, delay: 2200 }),
    ],
  },

  WINDY: {
    tint: "#A5CFC6",
    tintOpacity: 0.15,
    motes: [
      // Streaks rather than clouds: wind is only visible in what it moves, and long thin
      // shapes travelling sideways is the least literal way to say that.
      { x: 28, y: 12, size: 44, aspect: 0.035, rounding: 0.5, color: "#FFFFFF", opacity: 0.6, motion: "sway", duration: 2600 },
      { x: 58, y: 22, size: 32, aspect: 0.035, rounding: 0.5, color: "#FFFFFF", opacity: 0.5, motion: "sway", duration: 3200, delay: 500 },
      { x: 34, y: 84, size: 50, aspect: 0.03, rounding: 0.5, color: "#FFFFFF", opacity: 0.5, motion: "sway", duration: 2900, delay: 1100 },
      { x: 68, y: 94, size: 28, aspect: 0.035, rounding: 0.5, color: "#FFFFFF", opacity: 0.42, motion: "sway", duration: 3400, delay: 1700 },
      ...cloud({ x: 84, y: 60, size: 24, opacity: 0.34, duration: 7000 }),
    ],
  },

  RAIN: {
    tint: "#8FB0C7",
    tintOpacity: 0.17,
    motes: [
      ...cloud({ x: 22, y: 10, size: 34, opacity: 0.44, duration: 10000 }),
      ...rain({
        columns: [8, 19, 31, 43, 57, 69, 81, 93],
        // Scattered rather than level: with Reduce Motion on — the default — a single row
        // of drops reads as a dashed rule across the card.
        rows: [22, 61, 38, 84, 15, 70, 47, 92],
        color: "#5B87A8",
        opacity: 0.4,
        durations: [1400, 1700, 1250, 1600, 1500],
      }),
    ],
  },

  THUNDERY_SHOWERS: {
    // The darkest wash in the registry, and the one nearest its contrast limit — the storm
    // state is where the temptation to go moody collides with a display-size WBGT reading.
    tint: "#8695A6",
    tintOpacity: 0.14,
    motes: [
      ...cloud({ x: 28, y: 8, size: 38, opacity: 0.34, duration: 11000 }),
      /*
       * The flash is a wide, soft field rather than a drawn bolt.
       *
       * A bolt at an opacity the contrast budget can fund reads as a scratch on the screen.
       * The field also spends almost all of its time at its resting dimness — see
       * `RESTING_FADE` in `WeatherBackdrop` — so with Reduce Motion on it is barely there,
       * which is correct: a frozen flash is not lightning, it is a beige blob.
       */
      { x: 50, y: 34, size: 66, aspect: 0.5, rounding: 0.4, color: "#FFF6C9", opacity: 0.3, motion: "flash", duration: 4200 },
      ...rain({
        columns: [11, 24, 37, 50, 63, 76, 89],
        rows: [30, 72, 44, 88, 20, 60, 50],
        color: "#4E6980",
        opacity: 0.34,
        size: 1.2,
        durations: [1150, 1300, 1050, 1400],
      }),
    ],
  },
};

/**
 * The spec for a condition, or `undefined` when there is none.
 *
 * Falls back from the night variant to the day one, so a condition only needs a
 * `-night` entry when darkness actually changes how it looks. Rain, wind, cloud and storms
 * do not — the same reasoning `WeatherIcon` gives for its own sparse `NIGHT` map.
 */
export function backdropFor(condition: WeatherCondition, night: boolean): BackdropSpec | undefined {
  return (night ? BACKDROPS[`${condition}-night`] : undefined) ?? BACKDROPS[condition];
}
