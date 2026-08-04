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
 * Malay lands first of the four planned additions because it is Latin script and needs no
 * font work, so it exercises this list, `AppLanguage`, `resolveDeviceLanguage`, the i18n
 * registration and both pickers with the font problem held out. Bengali, Burmese and Tamil
 * follow together with the Noto font layer — Gelasio has no glyphs for any of those three,
 * and adding them here before the fonts exist would offer a worker a language that renders
 * as empty boxes. See `docs/plans/SCRUM-205-localisation-plan.md`.
 */
export const languagesArr = [
  { code: "en", label: "English" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "hi", label: "हिन्दी" },
  { code: "ms", label: "Bahasa Melayu" },
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

    if (tag.startsWith("zh")) {
      if (tag.includes("hant") || tag.includes("tw") || tag.includes("hk") || tag.includes("mo")) {
        continue;
      }
      return "zh-Hans";
    }
  }
  return "en";
}
