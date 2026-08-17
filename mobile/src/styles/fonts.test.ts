/**
 * Which face each language actually gets.
 *
 * ── THE BUG THIS EXISTS TO CATCH ────────────────────────────────────────────────────────
 * A language mapped to a face that has no glyphs for its script does not throw, warn, or fail
 * to build. It renders tofu boxes, or silently falls back to whatever the device happens to
 * have — and on Android that may be nothing. The screen looks *almost* right in review,
 * because the reviewer is reading English.
 *
 * That is the exact failure mode of the Lexend migration: Lexend publishes only the `latin`,
 * `latin-ext` and `vietnamese` subsets, so pointing Tamil, Bengali, Myanmar or Devanagari at
 * it would have been a one-line change with no compile error and no test failure — and safety
 * instructions no worker could read.
 *
 * So this asserts the mapping directly, per language, by name.
 */
import { familyFor, lineHeightBoostFor, AppFonts } from "./fonts";
import { supportedLanguages, type AppLanguage } from "@/localization/languagesList";

/** The scripts Lexend cannot draw, and the family each must therefore resolve to instead. */
const NON_LATIN: Partial<Record<AppLanguage, string>> = {
  ta: "NotoSansTamil",
  bn: "NotoSansBengali",
  my: "NotoSansMyanmar",
  hi: "NotoSansDevanagari",
};

const WEIGHTS = ["regular", "medium", "semiBold", "bold"] as const;

it("uses Lexend for Latin", () => {
  expect(AppFonts.regular).toBe("Lexend_400Regular");
  expect(familyFor("en").regular).toBe("Lexend_400Regular");
  expect(familyFor("ms").bold).toBe("Lexend_700Bold");
});

it.each(Object.entries(NON_LATIN))(
  "gives %s its own Noto family, never Lexend",
  (language, expectedFamily) => {
    const set = familyFor(language as AppLanguage);
    for (const weight of WEIGHTS) {
      expect(set[weight]).toContain(expectedFamily);
      // The assertion that matters: Lexend has no glyphs for any of these scripts.
      expect(set[weight]).not.toContain("Lexend");
    }
  },
);

it("resolves all four weights for every supported language", () => {
  // A Noto subset that ships only some weights degrades to the silent system fallback for the
  // rest — a bold heading in a different face from the body around it.
  for (const language of supportedLanguages) {
    for (const weight of WEIGHTS) {
      expect({ language, weight, family: familyFor(language)[weight] }).toEqual({
        language,
        weight,
        family: expect.stringMatching(/^(Lexend|NotoSans\w+)_\d{3}\w+$/),
      });
    }
  }
});

it("leaves Simplified Chinese on Lexend, and therefore on the system CJK face", () => {
  /*
   * Deliberate, and measured: @expo-google-fonts/noto-sans-sc is 96 MB unpacked across four
   * weights, about sixty times the whole Lexend package, and every Android and iOS device
   * ships a usable Simplified Chinese face. Lexend supplies the Latin run inside a Chinese
   * string; the system supplies the Han.
   *
   * Asserted so the decision is visible rather than looking like an omission.
   */
  expect(familyFor("zh-Hans").regular).toBe("Lexend_400Regular");
});

it("falls back to Lexend for an unrecognised language", () => {
  expect(familyFor("xx" as AppLanguage).regular).toBe("Lexend_400Regular");
});

/* ── Line-height boosts ────────────────────────────────────────────────────────────────── */

it("boosts the line box for every script that stacks marks", () => {
  // Tamil and Myanmar hang vowel signs below the baseline; Bengali and Devanagari both carry a
  // headline across the top of a word. The Latin ratio clips all four.
  for (const language of Object.keys(NON_LATIN) as AppLanguage[]) {
    expect({ language, boost: lineHeightBoostFor(language) > 1 }).toEqual({
      language,
      boost: true,
    });
  }
});

it("gives Devanagari the same boost as Bengali", () => {
  // They share the hanging headline, and Bengali's value was measured against that feature.
  expect(lineHeightBoostFor("hi")).toBe(lineHeightBoostFor("bn"));
});

it("leaves Latin and Han unboosted", () => {
  expect(lineHeightBoostFor("en")).toBe(1);
  expect(lineHeightBoostFor("ms")).toBe(1);
  expect(lineHeightBoostFor("zh-Hans")).toBe(1);
});
