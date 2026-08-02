/**
 * The three global accessibility settings, and the only slice that is persisted verbatim.
 *
 * These are the source of truth. The theme is derived from `highContrast` + `fontScale` on
 * every render (see `styles/theme.ts`), and i18n is driven from `language` by a single
 * subscriber (see `localization/LanguageSync.tsx`) rather than keeping its own copy in
 * AsyncStorage the way the reference app does. One store, one truth — a second copy is a
 * second thing to be wrong after a rehydrate.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { clampFontScale, FONT_SCALE_DEFAULT } from "@/styles/theme";
import type { AppLanguage } from "@/localization/languagesList";

export interface PreferencesState {
  language: AppLanguage;
  fontScale: number;
  highContrast: boolean;
  /**
   * Suppresses decorative motion in-app.
   *
   * Layered on top of the OS setting rather than replacing it: the device switch is
   * honoured automatically (see `useReduceMotion`), and this lets someone turn motion off
   * inside CrewSafe without turning it off system-wide — which matters on a shared site
   * phone nobody wants to reconfigure.
   */
  reduceMotion: boolean;
  /** False until the user picks a language explicitly; until then we follow the device. */
  languageChosenExplicitly: boolean;
}

/**
 * Exported so the persist migration can backfill it.
 *
 * redux-persist's default reconciler merges one level deep — it replaces each *slice*
 * wholesale with what was stored, rather than merging field by field. So a device that
 * saved this slice before a field existed rehydrates without that field, leaving it
 * `undefined` rather than at its default. Falsy-by-accident works until the first setting
 * whose default is `true`.
 */
export const initialPreferencesState: PreferencesState = {
  language: "en",
  fontScale: FONT_SCALE_DEFAULT,
  highContrast: false,
  reduceMotion: false,
  languageChosenExplicitly: false,
};

const initialState = initialPreferencesState;

const preferencesSlice = createSlice({
  name: "preferences",
  initialState,
  reducers: {
    setLanguage: (state, action: PayloadAction<AppLanguage>) => {
      state.language = action.payload;
      state.languageChosenExplicitly = true;
    },
    /**
     * Applied on first launch only. Separate from `setLanguage` so that following the
     * device locale never counts as the user having chosen — otherwise a phone whose
     * locale later changes would be stuck on whatever it was at install time.
     */
    setLanguageFromDevice: (state, action: PayloadAction<AppLanguage>) => {
      if (!state.languageChosenExplicitly) {
        state.language = action.payload;
      }
    },
    setFontScale: (state, action: PayloadAction<number>) => {
      state.fontScale = clampFontScale(action.payload);
    },
    setHighContrast: (state, action: PayloadAction<boolean>) => {
      state.highContrast = action.payload;
    },
    toggleHighContrast: (state) => {
      state.highContrast = !state.highContrast;
    },
    setReduceMotion: (state, action: PayloadAction<boolean>) => {
      state.reduceMotion = action.payload;
    },
  },
});

export const {
  setLanguage,
  setLanguageFromDevice,
  setFontScale,
  setHighContrast,
  toggleHighContrast,
  setReduceMotion,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
