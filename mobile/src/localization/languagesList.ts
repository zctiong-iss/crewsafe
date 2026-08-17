/**
 * The languages CrewSafe ships.
 *
 * Chosen for Singapore's outdoor-work population rather than for coverage: English as the
 * lingua franca, then the languages actually spoken on site. Each label is written in its
 * own script — a worker looking for their language should not have to read English to find
 * it, which is the entire reason the picker is also reachable from the sign-in screen.
 *
 * FR-26c requires an approved language-neutral pictogram when a worker's language is
 * unsupported. That is a screen-level concern (rest / hydrate / stop-work / resume icons),
 * not a list entry, and it is handled in the action components rather than here.
 *
 * ── SCRUM-205 ───────────────────────────────────────────────────────────────────────────
 * Malay landed first because it is Latin script and needed no font work, so it exercised
 * this list, `AppLanguage`, `resolveDeviceLanguage`, the i18n registration and both pickers
 * with the font problem held out. Tamil, Bengali and Burmese follow here, together with the
 * Noto font layer they depend on — the Latin face has no glyphs for any of the three, so listing
 * them before the fonts existed would have offered a worker a language that renders as empty
 * boxes. See `docs/plans/SCRUM-205-localisation-plan.md` and `styles/fonts.ts`.
 *
 * Burmese is Unicode only. Myanmar's national migration to Unicode completed in 2019 and
 * Android 12+ ships Unicode Myanmar fonts, so Zawgyi is treated as legacy and not detected
 * or transcoded. A worker on a Zawgyi-only device sees garbled Burmese and can switch to
 * another language from the sign-in picker, which is reachable precisely so that a phone
 * left in an unreadable language is never a dead end. The decision is recorded in the README
 * because the failure looks like a bad translation rather than an encoding mismatch.
 *
 * @author Justin Chua
 */
export const languagesArr = [
  { code: "en", label: "English" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "hi", label: "हिन्दी" },
  { code: "ms", label: "Bahasa Melayu" },
  { code: "ta", label: "தமிழ்" },
  { code: "bn", label: "বাংলা" },
  { code: "my", label: "မြန်မာ" },
] as const;

export type AppLanguage = (typeof languagesArr)[number]["code"];

export const supportedLanguages: readonly AppLanguage[] = languagesArr.map((l) => l.code);

export function isSupportedLanguage(value: string): value is AppLanguage {
  return (supportedLanguages as readonly string[]).includes(value);
}

/**
 * Maps a device locale onto a supported language.
 *
 * Locale tags arrive in many shapes — `zh-Hans-SG`, `zh-CN`, `zh` — and all of them mean
 * Simplified Chinese here. Prefix matching on the bare language subtag would map `zh-Hant`
 * (Traditional) onto Simplified too, which is wrong, so Traditional is left to fall through
 * to English rather than silently shown the wrong script.
 */
export function resolveDeviceLanguage(locales: readonly string[]): AppLanguage {
  for (const locale of locales) {
    const tag = locale.toLowerCase();

    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("hi")) return "hi";

    /*
     * `ms` covers Malaysia and Singapore. `id` (Indonesian) is deliberately NOT mapped here
     * despite the two being close enough to be mutually intelligible in writing: they
     * differ in exactly the register this app lives in — safety and workplace vocabulary —
     * and quietly showing an Indonesian speaker Malay would be a guess made on their
     * behalf about a stop-work instruction. They fall through to English, and can pick
     * Malay themselves from the picker if they prefer it.
     */
    if (tag.startsWith("ms")) return "ms";

    if (tag.startsWith("ta")) return "ta";
    if (tag.startsWith("bn")) return "bn";
    /*
     * Both tags for Burmese. `my` is the ISO 639-1 code and what Android reports; `mya` and
     * `bur` are the two 639-2 codes for the same language, and a device that reports either
     * should not silently fall through to English.
     */
    if (tag.startsWith("my") || tag.startsWith("mya") || tag.startsWith("bur")) return "my";

    if (tag.startsWith("zh")) {
      if (tag.includes("hant") || tag.includes("tw") || tag.includes("hk") || tag.includes("mo")) {
        continue;
      }
      return "zh-Hans";
    }
  }
  return "en";
}
