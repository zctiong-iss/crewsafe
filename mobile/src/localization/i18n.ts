/**
 * i18next setup.
 *
 * Two deliberate differences from the reference app:
 *
 * 1. No i18next language detector, and no separate "LANGUAGE" key in AsyncStorage. The
 *    persisted `preferences.language` is the single source of truth, and `LanguageSync`
 *    pushes it into i18next. The reference keeps two copies, which can disagree after a
 *    rehydrate — the app renders in one language while Settings shows another.
 *
 * 2. `useSuspense: false`. React Native does not fully support Suspense for data, and with
 *    it enabled a missing bundle renders as a permanently blank screen rather than as
 *    fallback text.
 *
 * Resources are imported statically rather than lazily so every string is inside the JS
 * bundle. A worker who loses signal mid-shift must not lose their language.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zhHans from "./zh-Hans.json";
import hi from "./hi.json";
import ms from "./ms.json";
import ta from "./ta.json";
import bn from "./bn.json";
import my from "./my.json";

/*
 * ── TRANSLATION REVIEW STATUS ───────────────────────────────────────────────────────────
 * `ms`, `ta`, `bn` and `my` (SCRUM-205) are machine-drafted and have NOT been reviewed by
 * native speakers. Their safety strings — `lightning.*`, `actions.*`, `guidance.*`,
 * `wbgt.stopWorkOverride`, `freshness.staleWarning` — must be signed off before those languages
 * are offered in production. Each locale file carries the same warning in its
 * `_translationStatus` key, which is metadata rather than a string the app renders.
 *
 * ── FONTS ARE PART OF THIS ──────────────────────────────────────────────────────────────
 * Registering a language here is only half of supporting it. Tamil, Bengali and Burmese
 * have no glyphs in Gelasio, so each also needs its Noto family loaded in `App.tsx` and
 * mapped in `styles/fonts.ts`. Adding a locale file without that renders tofu — a language
 * that is present in the picker and unreadable on screen.
 *
 * `my` is Myanmar **Unicode**, not Zawgyi. See `my.json`'s `_encoding` key and the README.
 */
export const resources = {
  en: { translation: en },
  "zh-Hans": { translation: zhHans },
  hi: { translation: hi },
  ms: { translation: ms },
  ta: { translation: ta },
  bn: { translation: bn },
  my: { translation: my },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "translation",
  ns: ["translation"],
  react: {
    useSuspense: false,
  },
  interpolation: {
    // React already escapes everything it renders; escaping again turns an apostrophe into
    // &#39; on screen.
    escapeValue: false,
  },
});

export default i18n;
