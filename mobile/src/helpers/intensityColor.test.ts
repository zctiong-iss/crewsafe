/**
 * The intensity ramp has to stay readable in both directions (SCRUM-266).
 *
 * Each colour is used two ways: as a fill under white text in the picker, and as text on the
 * white card in the shift detail. Both are the same ratio, so one check covers both — but the
 * failure it guards against is real and easy to reintroduce. Plain `warning` (#B26A00) is
 * 4.24:1 and would put the selected "Moderate" label under the AA floor; the palette carries a
 * darkened amber precisely because of that, and nothing but this test would catch someone
 * simplifying it back.
 *
 * Both palettes are checked. High contrast darkens the ramp, so it can only improve — but it
 * is a separate set of literals, and a typo in one of them would be invisible on a desk.
 *
 * @author Justin Chua
 */
import { intensityColor } from "./intensityColor";
import { palettes } from "@/styles/colors";
import type { Intensity } from "@/types/domain";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const WHITE: Rgb = [255, 255, 255];
const AA_NORMAL_TEXT = 4.5;

const INTENSITIES: Intensity[] = ["LIGHT", "MODERATE", "HEAVY"];

describe.each(["standard", "highContrast"] as const)("%s palette", (name) => {
  const palette = palettes[name];

  it.each(INTENSITIES)("carries white text at AA for %s", (intensity) => {
    const ratio = contrast(parseHex(intensityColor(palette, intensity)), WHITE);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("gives the three intensities three distinct colours", () => {
    // A ramp that collapsed to one colour would still pass every contrast check above while
    // saying nothing at all.
    const colours = INTENSITIES.map((intensity) => intensityColor(palette, intensity));
    expect(new Set(colours).size).toBe(3);
  });
});
