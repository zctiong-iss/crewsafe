/**
 * The resolved look of the app: palette + text scaling + the metrics that change with
 * high contrast.
 *
 * A theme is derived, never stored. The stored state is three plain preferences
 * (`highContrast`, `fontScale`, `language`) in the persisted preferences slice; this module
 * turns two of them into everything a component needs. Storing the derived theme instead
 * would mean a rehydrated app could come back with a palette that no longer matches the
 * code that produced it.
 */
import { palettes, type AppPalette } from "./colors";

/**
 * Text-size multiplier, applied on top of `react-native-size-matters`' device scaling.
 *
 * Deliberately capped at 1.5. Past that, the fixed-height controls the reference design
 * uses start clipping their own labels, which is a worse accessibility outcome than
 * slightly-small text. Growing past this cap needs the layouts to reflow first.
 */
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.5;
export const FONT_SCALE_DEFAULT = 1;

export const FONT_SCALE_STEPS = [
  { key: "small", value: 0.85 },
  { key: "default", value: 1 },
  { key: "large", value: 1.2 },
  { key: "extraLarge", value: 1.5 },
] as const;

export type FontScaleKey = (typeof FONT_SCALE_STEPS)[number]["key"];

export interface AppMetrics {
  /** Hairlines vanish in sunlight; high contrast doubles every stroke. */
  borderWidth: number;
  /** Minimum tappable edge. Grows in high contrast — gloved hands, uneven ground. */
  minTouchTarget: number;
  radius: number;
}

export interface AppTheme {
  colors: AppPalette;
  metrics: AppMetrics;
  fontScale: number;
  highContrast: boolean;
}

export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

export function buildTheme(highContrast: boolean, fontScale: number): AppTheme {
  return {
    colors: highContrast ? palettes.highContrast : palettes.standard,
    metrics: {
      borderWidth: highContrast ? 2 : 1,
      minTouchTarget: highContrast ? 52 : 44,
      // Square-ish corners read as higher contrast than pills at a distance, because the
      // edge stays straight for longer.
      radius: highContrast ? 6 : 12,
    },
    fontScale: clampFontScale(fontScale),
    highContrast,
  };
}

export const defaultTheme = buildTheme(false, FONT_SCALE_DEFAULT);
