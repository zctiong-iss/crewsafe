/**
 * One typeface per script, resolved from the active language.
 *
 * Gelasio, designed by Eben Sorkin, remains the project's typeface for Latin. It is loaded
 * from `@expo-google-fonts/gelasio` rather than committed .ttf files: the package ships the
 * same binaries, keeps them out of git, and gives us the exact family-name constants below
 * so a typo becomes a compile error instead of a silent fallback to the system font. A
 * silent fallback is easy to miss on Android, where the default face is close enough to pass
 * a glance.
 *
 * ── WHY THERE IS MORE THAN ONE FAMILY NOW (SCRUM-205) ───────────────────────────────────
 * Gelasio covers Latin, Cyrillic and Greek. It has **no glyphs at all** for Tamil, Bengali
 * or Myanmar. Rendering those languages in it produces tofu boxes, or a silent fall back to
 * whatever the system happens to have — which on Android may be nothing. A translated screen
 * nobody can read is worse than an untranslated one, because the untranslated one is at
 * least legible to someone.
 *
 * So each of the three new scripts gets its matching Noto family. All four weights the app
 * uses (400/500/600/700) exist in all four families, which was checked rather than assumed —
 * Noto subsets do not uniformly ship every weight, and a missing one degrades to exactly the
 * silent fallback this file exists to prevent.
 *
 * ── RESOLVED FROM THE LANGUAGE, NOT FROM THE STRING ─────────────────────────────────────
 * `familyFor(language)` picks the family, rather than inspecting each string for the script
 * it contains. Every string the app renders is in the active language, so per-string
 * detection would cost work on every text node to answer a question the language already
 * answers. It also stays predictable: one language, one face, no mid-sentence switching.
 *
 * The mixed-content case is covered because the Noto families include basic Latin. "32.4 °C
 * WBGT" on a Tamil screen renders from Noto Sans Tamil rather than falling back per glyph to
 * a different face, which is what keeps the WBGT card looking like one typeface and not two.
 *
 * @author Justin Chua
 */
import type { AppLanguage } from "@/localization/languagesList";

export const AppFonts = {
  regular: "Gelasio_400Regular",
  medium: "Gelasio_500Medium",
  semiBold: "Gelasio_600SemiBold",
  bold: "Gelasio_700Bold",
} as const;

export type AppFontWeight = keyof typeof AppFonts;

/** The four weights of one family, in the shape `AppText` consumes. */
export type FontFamilySet = Record<AppFontWeight, string>;

const GELASIO: FontFamilySet = AppFonts;

const NOTO_TAMIL: FontFamilySet = {
  regular: "NotoSansTamil_400Regular",
  medium: "NotoSansTamil_500Medium",
  semiBold: "NotoSansTamil_600SemiBold",
  bold: "NotoSansTamil_700Bold",
};

const NOTO_BENGALI: FontFamilySet = {
  regular: "NotoSansBengali_400Regular",
  medium: "NotoSansBengali_500Medium",
  semiBold: "NotoSansBengali_600SemiBold",
  bold: "NotoSansBengali_700Bold",
};

const NOTO_MYANMAR: FontFamilySet = {
  regular: "NotoSansMyanmar_400Regular",
  medium: "NotoSansMyanmar_500Medium",
  semiBold: "NotoSansMyanmar_600SemiBold",
  bold: "NotoSansMyanmar_700Bold",
};

/**
 * Language → family. Anything absent uses Gelasio, which is correct for every Latin
 * language and is also the right answer for an unrecognised value.
 *
 * Hindi is deliberately **not** here. It is Devanagari, which Gelasio also lacks — but Hindi
 * shipped long before this change and has been rendering through the system's Devanagari
 * fallback all along. Moving it onto a Noto family is a visual change to an already-shipped
 * language and deserves its own ticket with its own before-and-after, rather than riding
 * along unannounced in this one.
 */
const FAMILY_BY_LANGUAGE: Partial<Record<AppLanguage, FontFamilySet>> = {
  ta: NOTO_TAMIL,
  bn: NOTO_BENGALI,
  my: NOTO_MYANMAR,
};

export function familyFor(language: AppLanguage): FontFamilySet {
  return FAMILY_BY_LANGUAGE[language] ?? GELASIO;
}

/**
 * Extra line height these scripts need beyond the Latin ratio, as a multiplier.
 *
 * Tamil, Bengali and Myanmar stack marks above and below the base glyph — Bengali hangs a
 * headline (matra) across the top of a word, Tamil and Myanmar carry vowel signs that sit
 * well below the baseline. The 1.35 ratio tuned for Gelasio clips them, and the clipping is
 * subtle enough to survive review: a diacritic loses its top, the word is still *nearly*
 * right, and that is exactly how a wrong word reaches a worker.
 *
 * Applied as a multiplier on top of the base ratio rather than replacing it, so a future
 * change to the Latin ratio carries through instead of silently applying to one script only.
 */
const LINE_HEIGHT_BOOST: Partial<Record<AppLanguage, number>> = {
  ta: 1.2,
  bn: 1.25,
  my: 1.35,
};

export function lineHeightBoostFor(language: AppLanguage): number {
  return LINE_HEIGHT_BOOST[language] ?? 1;
}
