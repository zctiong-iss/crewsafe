/**
 * One typeface per script, resolved from the active language.
 *
 * **Lexend** is the project's typeface for Latin, matching web (ADR-0012) and satisfying the
 * Latin half of ADR-0017's D1. It replaced Gelasio, and the reason is the same one web gave:
 * Lexend is drawn for reading proficiency and legibility under difficult conditions, which is
 * the ordinary case here — a phone at arm's length, in sun, read at a glance, sometimes in
 * gloves. Gelasio is a serif drawn for text setting; it was never chosen for this.
 *
 * Loaded from `@expo-google-fonts/lexend` rather than committed .ttf files: the package ships
 * the same binaries, keeps them out of git, and gives us the exact family-name constants below
 * so a typo becomes a compile error instead of a silent fallback to the system font. A silent
 * fallback is easy to miss on Android, where the default face is close enough to pass a glance.
 *
 * ── WHY LEXEND IS NOT THE ANSWER FOR EVERY LANGUAGE ─────────────────────────────────────
 * Lexend publishes exactly three subsets: `latin`, `latin-ext` and `vietnamese`. It has **no
 * glyphs at all** for Tamil, Bengali, Myanmar, Devanagari or Han — verified against the
 * Google Fonts CSS API rather than assumed. Rendering those languages in it produces tofu
 * boxes, or a silent fall back to whatever the system happens to have, which on Android may
 * be nothing. A translated screen nobody can read is worse than an untranslated one, because
 * the untranslated one is at least legible to someone.
 *
 * So "Lexend everywhere" is a Latin-only statement by necessity, and D1 says as much: Lexend
 * for Latin, per-script Noto for the rest. Each non-Latin script keeps its matching Noto
 * family. All four weights the app uses (400/500/600/700) exist in every family here, which
 * was checked rather than assumed — Noto subsets do not uniformly ship every weight, and a
 * missing one degrades to exactly the silent fallback this file exists to prevent.
 *
 * ── SIMPLIFIED CHINESE IS THE ONE DELIBERATE GAP ────────────────────────────────────────
 * `zh-Hans` has no bundled face and falls through to the system's CJK font. That is a
 * measured decision, not an oversight: `@expo-google-fonts/noto-sans-sc` is **96 MB**
 * unpacked across the four weights — about sixty times the entire Lexend package — and every
 * Android and iOS device ships a usable Simplified Chinese face already. The trade that makes
 * sense for Tamil (a few MB, and Android may genuinely have nothing) does not hold here.
 * Revisit only with a subset build; see SCRUM-TBD-58.
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
  regular: "Lexend_400Regular",
  medium: "Lexend_500Medium",
  semiBold: "Lexend_600SemiBold",
  bold: "Lexend_700Bold",
} as const;

export type AppFontWeight = keyof typeof AppFonts;

/** The four weights of one family, in the shape `AppText` consumes. */
export type FontFamilySet = Record<AppFontWeight, string>;

const LEXEND: FontFamilySet = AppFonts;

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

const NOTO_DEVANAGARI: FontFamilySet = {
  regular: "NotoSansDevanagari_400Regular",
  medium: "NotoSansDevanagari_500Medium",
  semiBold: "NotoSansDevanagari_600SemiBold",
  bold: "NotoSansDevanagari_700Bold",
};

/**
 * Language → family. Anything absent uses Lexend, which is correct for every Latin language
 * (`en`, `ms`) and is also the right answer for an unrecognised value.
 *
 * `zh-Hans` is absent on purpose and therefore resolves to Lexend, which supplies the Latin
 * run in a Chinese string while the system's CJK face supplies the Han. See the note at the
 * top of this file for why no CJK family is bundled.
 *
 * Hindi joined this map when Lexend landed. It had been rendering through the system's
 * Devanagari fallback since it shipped — Gelasio lacked the script and so does Lexend — which
 * meant its typeface was whatever the device happened to have. That is the silent fallback
 * this file exists to prevent, and leaving it in place while explicitly changing the Latin
 * face would have been choosing to fix the language that was already fine.
 */
const FAMILY_BY_LANGUAGE: Partial<Record<AppLanguage, FontFamilySet>> = {
  ta: NOTO_TAMIL,
  bn: NOTO_BENGALI,
  my: NOTO_MYANMAR,
  hi: NOTO_DEVANAGARI,
};

export function familyFor(language: AppLanguage): FontFamilySet {
  return FAMILY_BY_LANGUAGE[language] ?? LEXEND;
}

/**
 * Extra line height these scripts need beyond the Latin ratio, as a multiplier.
 *
 * Tamil, Bengali, Myanmar and Devanagari stack marks above and below the base glyph — Bengali
 * and Devanagari both hang a headline (matra/shirorekha) across the top of a word, Tamil and
 * Myanmar carry vowel signs that sit well below the baseline. The base Latin ratio clips them,
 * and the clipping is subtle enough to survive review: a diacritic loses its top, the word is
 * still *nearly* right, and that is exactly how a wrong word reaches a worker.
 *
 * Applied as a multiplier on top of the base ratio rather than replacing it, so a future
 * change to the Latin ratio carries through instead of silently applying to one script only.
 * That is what kept these correct when Gelasio became Lexend: the boosts describe the scripts,
 * not the Latin face they sit beside.
 *
 * Devanagari is set at Bengali's 1.25 — the two share the hanging headline, and Bengali's
 * value was measured against exactly that feature.
 */
const LINE_HEIGHT_BOOST: Partial<Record<AppLanguage, number>> = {
  ta: 1.2,
  bn: 1.25,
  my: 1.35,
  hi: 1.25,
};

export function lineHeightBoostFor(language: AppLanguage): number {
  return LINE_HEIGHT_BOOST[language] ?? 1;
}
