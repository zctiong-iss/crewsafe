/**
 * The three languages CrewSafe ships.
 *
 * Chosen for Singapore's outdoor-work population rather than for coverage: English as the
 * lingua franca, Simplified Chinese, and Hindi. Each label is written in its own script —
 * a worker looking for their language should not have to read English to find it.
 *
 * FR-26c requires an approved language-neutral pictogram when a worker's language is
 * unsupported. That is a screen-level concern (rest / hydrate / stop-work / resume icons),
 * not a list entry, and it is handled in the action components rather than here.
 */
export const languagesArr = [
  { code: "en", label: "English" },
  { code: "zh-Hans", label: "简体中文" },
  { code: "hi", label: "हिन्दी" },
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

    if (tag.startsWith("zh")) {
      if (tag.includes("hant") || tag.includes("tw") || tag.includes("hk") || tag.includes("mo")) {
        continue;
      }
      return "zh-Hans";
    }
  }
  return "en";
}
