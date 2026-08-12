/**
 * The colour that stands for a work intensity (SCRUM-266).
 *
 * One resolver rather than a ternary at each call site: the picker, the shift detail card and
 * anything added later must agree, or the same word would be amber in one place and red two
 * screens away. Takes the palette instead of reading the theme itself so it stays a pure
 * function and works inside `StyleSheet` composition.
 *
 * Exhaustive over `Intensity` by construction — a fourth intensity would fail to typecheck
 * here rather than silently rendering in whatever colour the fallback happened to be.
 *
 * @author Justin Chua
 */
import type { AppPalette } from "@/styles/colors";
import type { Intensity } from "@/types/domain";

export function intensityColor(palette: AppPalette, intensity: Intensity): string {
  const byIntensity: Record<Intensity, string> = {
    LIGHT: palette.intensityLight,
    MODERATE: palette.intensityModerate,
    HEAVY: palette.intensityHeavy,
  };
  return byIntensity[intensity];
}
