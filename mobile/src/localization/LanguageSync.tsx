/**
 * The one place that pushes `preferences.language` into i18next.
 *
 * Keeping this as a single subscriber — rather than calling `i18n.changeLanguage` from
 * every screen that offers a language switch — means the store stays the source of truth
 * and the two can never disagree. It also handles first launch: if the user has never
 * chosen a language, we adopt the device's, which is the closest thing to a right guess.
 *
 * Renders nothing.
 */
import { useEffect } from "react";
import { getLocales } from "expo-localization";
import i18n from "./i18n";
import { resolveDeviceLanguage } from "./languagesList";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setLanguageFromDevice } from "@/store/reducers/preferencesSlice";

export default function LanguageSync() {
  const dispatch = useAppDispatch();
  const language = useAppSelector((state) => state.preferences.language);
  const chosenExplicitly = useAppSelector((state) => state.preferences.languageChosenExplicitly);

  // First launch only. `setLanguageFromDevice` is a no-op once the user has chosen, so a
  // later device-locale change never overrides a deliberate choice.
  useEffect(() => {
    if (chosenExplicitly) return;
    const locales = getLocales().map((locale) => locale.languageTag);
    dispatch(setLanguageFromDevice(resolveDeviceLanguage(locales)));
  }, [chosenExplicitly, dispatch]);

  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language]);

  return null;
}
