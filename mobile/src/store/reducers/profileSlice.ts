/**
 * Profile photos, keyed by user id.
 *
 * ── MISSING BACKEND ─────────────────────────────────────────────────────────────────────
 * There is no avatar anywhere in the API. `GET /api/v1/me` returns id, username,
 * displayName, role and siteIds — `MeResponse.java` has no image field, and nothing accepts
 * an upload. So a photo picked here lives on this device only: it will not follow the
 * worker to another phone and their supervisor will never see it.
 *
 * Making it real needs a backend decision first, not just an endpoint. A worker photo is
 * personal data under FR-33's minimisation rule, and on a heat-safety app it is close to
 * biometric — so it needs a retention answer, a consent answer and a deletion path before
 * it needs a `PUT /api/v1/me/avatar`. This slice is deliberately the smallest thing that
 * works locally until that conversation happens.
 *
 * ── WHY IT IS KEYED BY USER ─────────────────────────────────────────────────────────────
 * Preferences are device-level and survive a sign-out on purpose — high contrast should not
 * have to be set again every shift. A face must not work that way. On a shared site phone,
 * a photo stored device-wide would show the previous worker's face above the next worker's
 * name, which is worse than having no photo at all. Keying by user id means the map can
 * persist across sign-outs while only ever resolving for the person actually signed in.
 *
 * @author Justin Chua
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ProfileState {
  /** userId → local file URI. See `helpers/avatarStorage.ts` for where that URI points. */
  avatars: Record<string, string>;
}

const initialState: ProfileState = {
  avatars: {},
};

const profileSlice = createSlice({
  name: "profile",
  initialState,
  reducers: {
    avatarSet: (state, action: PayloadAction<{ userId: string; uri: string }>) => {
      state.avatars[action.payload.userId] = action.payload.uri;
    },
    avatarCleared: (state, action: PayloadAction<string>) => {
      delete state.avatars[action.payload];
    },
  },
});

export const { avatarSet, avatarCleared } = profileSlice.actions;

export default profileSlice.reducer;
