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

export const resources = {
  en: { translation: en },
  "zh-Hans": { translation: zhHans },
  hi: { translation: hi },
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
