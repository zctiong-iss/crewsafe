/**
 * The global accessibility settings, and the only slice that is persisted verbatim.
 *
 * These are the source of truth. The theme is derived from `highContrast` + `fontScale` on
 * every render (see `styles/theme.ts`), and i18n is driven from `language` by a single
 * subscriber (see `localization/LanguageSync.tsx`) rather than keeping its own copy in
 * AsyncStorage the way the reference app does. One store, one truth — a second copy is a
 * second thing to be wrong after a rehydrate.
 *
 * ── ONE OF THESE IS PER-USER, THE REST ARE PER-DEVICE ───────────────────────────────────
 * `reduceMotion` is keyed by user id (SCRUM-199); language, text size and high contrast are
 * not. That is a deliberate line rather than an inconsistency left lying around.
 *
 * High contrast and text size answer a question about the *phone and the light it is being
 * read in* — a site phone that needs high contrast at noon needs it for whoever is holding
 * it, and making the next worker set it again every morning is the cost the existing
 * comment in `persistConfig` refuses to pay. Reduce motion answers a question about the
 * *person*: vestibular sensitivity belongs to a body, not to a handset, and a new worker
 * inheriting the last one's answer to it is simply wrong.
 *
 * If the other three ever need per-user scope too, the shape below generalises — but that
 * is a separate decision with a real cost, not a tidy-up.
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { clampFontScale, FONT_SCALE_DEFAULT } from "@/styles/theme";
import type { AppLanguage } from "@/localization/languagesList";

/**
 * What one user has said about motion, if anything.
 *
 * Absence is the meaningful state: no entry means this account has never been asked, which
 * is what makes "on by default at first login" work per person rather than per phone.
 */
export interface ReduceMotionChoice {
  reduceMotion: boolean;
}

/**
 * Applied to anyone with no entry of their own.
 *
 * Also what the app runs on before any user is resolved — see `selectReduceMotionFor`.
 */
export const REDUCE_MOTION_DEFAULT = true;

export interface PreferencesState {
  language: AppLanguage;
  fontScale: number;
  highContrast: boolean;
  /**
   * userId → that user's choice. Absent until they work the switch themselves.
   *
   * Keyed for the same reason `profileSlice` keys avatars, and the reasoning there applies
   * directly: the map can persist across sign-outs precisely because it only ever resolves
   * for the person actually signed in. A device-level boolean on a shared site phone hands
   * the next worker the previous worker's accessibility setting.
   *
   * Suppresses decorative motion in-app, layered on top of the OS setting rather than
   * replacing it — the device switch is honoured automatically (see `useReduceMotion`), and
   * this lets someone turn motion off inside CrewSafe without turning it off system-wide.
   *
   * Defaults to ON. The operating condition argues for it: the app is read at arm's length
   * in glare, often by someone who has never been asked whether they want animation, and a
   * pulsing glyph is harder to parse in that setting than a still one. Starting motion off
   * and letting anyone who wants it turn it on is the safer default than the reverse.
   *
   * Entries accumulate for the life of the install, one small record per account that has
   * ever signed in here — the same unbounded-growth caveat `profileSlice` carries, and at a
   * boolean per user it is a great deal cheaper than that one.
   */
  reduceMotionByUser: Record<string, ReduceMotionChoice>;
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
  // Empty, not seeded. Every account is "never asked" until it signs in and either accepts
  // the default or overrides it — including the very first one on a brand-new install.
  reduceMotionByUser: {},
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
    /**
     * One user working the switch, either way.
     *
     * Writing an entry on `false` is the half that matters: turning the setting *off* is
     * exactly as deliberate as turning it on, and both must survive a sign-out and every
     * later launch. Recording only the `true` case would leave a worker who switched it off
     * indistinguishable from one who never touched it — and they would silently get the
     * default back on their next login.
     *
     * The user id is passed in rather than read from `auth` here: a reducer cannot reach
     * another slice, and threading it through the action keeps the write explicit about
     * whose setting is being changed.
     */
    setReduceMotion: (
      state,
      action: PayloadAction<{ userId: string; reduceMotion: boolean }>,
    ) => {
      state.reduceMotionByUser[action.payload.userId] = {
        reduceMotion: action.payload.reduceMotion,
      };
    },
    /** Forgets one user's choice, so their next login starts from the default again. */
    reduceMotionCleared: (state, action: PayloadAction<string>) => {
      delete state.reduceMotionByUser[action.payload];
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
  reduceMotionCleared,
} = preferencesSlice.actions;

/**
 * One user's effective in-app preference, defaulting for anyone with no entry.
 *
 * `userId` is nullable on purpose. `auth.user` is not persisted — it is re-fetched from
 * `GET /api/v1/me` on every launch so a revoked role cannot linger — while `preferences`
 * rehydrates immediately, so there is a window on every cold start, plus the whole sign-in
 * screen, where the app renders with nobody resolved. Defaulting that window to the same
 * value a first-time user gets means the setting never visibly changes underneath someone
 * as their profile lands, and the app never animates at a person it has not yet asked.
 */
export function selectReduceMotionFor(
  byUser: Record<string, ReduceMotionChoice>,
  userId: string | null | undefined,
): boolean {
  if (!userId) return REDUCE_MOTION_DEFAULT;
  return byUser[userId]?.reduceMotion ?? REDUCE_MOTION_DEFAULT;
}

export default preferencesSlice.reducer;
