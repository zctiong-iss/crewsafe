/**
 * The colour a WBGT band is drawn in, matching MOM's "Heat Stress Measures for Outdoor Work".
 *
 * ── THIS IS NOT DERIVING A BAND ─────────────────────────────────────────────────────────
 * The distinction matters, because `types/domain.ts` and `WbgtBand.java` both forbid a client
 * deciding what a WBGT number means (FR-15, §12.2) — a second copy of the 31/32/33 boundaries
 * is a second authority, and two authorities eventually disagree about whether someone is owed
 * a break.
 *
 * Nothing here reads a temperature. It takes a band the server already evaluated and returns a
 * colour, which is the same latitude `helpers/weather.ts` has for picking a weather icon: it is
 * presentation, and nothing acts on it. Hand this a number and it will not compile.
 *
 * ── WHY THREE COLOURS FOR FOUR BANDS ────────────────────────────────────────────────────
 * MOM's poster has three columns; our bands are finer, because the required rest changes at 32
 * (ten minutes hourly) while the poster's amber column covers 31 to 33 as one block. So both
 * middle bands take amber: the colour follows the poster a supervisor has seen on a wall, and
 * the band label beside it carries the finer distinction our data actually holds.
 *
 * ── WHY THE COLOUR IS NEVER ALONE ───────────────────────────────────────────────────────
 * Every caller renders the band's words next to the value. Colour alone fails WCAG 1.4.1, and
 * on a worksite it fails for two more ordinary reasons: sunlight flattens hue on a phone, and
 * red/green is the commonest colour-vision deficiency there is. The colour is the fast signal;
 * the words are the actual one.
 *
 * @author Justin Chua
 */
import type { AppPalette } from "@/styles/colors";
import type { WbgtBand } from "@/types/domain";

/**
 * @param band a server-evaluated band, or null when none was supplied
 * @returns the palette colour for the band, or null when there is no band to colour — callers
 *          must fall back to ordinary text rather than to the coolest band, since an unknown
 *          reading rendered green would read as a safe one
 */
export function wbgtBandColor(band: WbgtBand | null | undefined, colors: AppPalette): string | null {
  switch (band) {
    case "BELOW_31":
      return colors.success;
    case "31_TO_BELOW_32":
    case "32_TO_BELOW_33":
      // `warning`, not `warningFill`: this colours text on a light surface, which is the case
      // `warning` was contrast-checked for. `warningFill` exists for the opposite problem —
      // carrying white text on top of amber.
      return colors.warning;
    case "33_AND_ABOVE":
      return colors.danger;
    default:
      return null;
  }
}
