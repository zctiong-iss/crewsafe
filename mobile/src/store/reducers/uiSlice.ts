/**
 * Transient, app-wide notices.
 *
 * ── WHEN TO SHOW A TOAST, AND WHEN NOT TO ───────────────────────────────────────────────
 * Only when the result of an action is *not visible on the screen the user ends up on*.
 *
 *   Deleting a shift    pops back to the list. The shift is simply gone, which is
 *                       ambiguous — did it work, or did the screen just close? Toast.
 *   Creating a shift    same: back to a list where a new row is easy to miss. Toast.
 *   Acknowledging       the card flips to "Acknowledged at 14:32" with a tick, in place.
 *                       A toast on top of that is telling someone what they can already
 *                       see, and every redundant notice makes the next one easier to
 *                       ignore. No toast.
 *
 * Failures that interrupt a deliberate, destructive flow use a native Alert instead — the
 * user is already in a modal interaction and a message that can scroll off-screen is not an
 * acceptable way to report that a delete did not happen.
 *
 * @author Justin Chua
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ToastTone = "success" | "danger" | "info";

export interface UiState {
  /** i18n key, translated at render so it follows a language change. */
  messageKey: string | null;
  tone: ToastTone;
  /** Bumped on every show so an identical repeat message still restarts the timer. */
  nonce: number;
  /**
   * True while the supervisor is actually looking at the plans list (SCRUM-TBD-NOTIFY).
   *
   * ── WHY THE STORE HAS TO KNOW WHICH SCREEN IS OPEN ──────────────────────────────────
   * The plans list already announces a newly-arrived plan with a toast, and the store's
   * notification listener announces the same plan with an OS notification. Both are correct
   * in isolation and together they are one event reported twice, half a second apart, to
   * someone who is already looking at the row it is about.
   *
   * The rule the file header states resolves it: a notice is for a result that is NOT
   * visible on the screen the user is on. The toast wins while the list is open; the
   * notification is for every other moment, which is the case it was built for.
   *
   * Transient, and `ui` is deliberately not persisted — a `true` rehydrated from disk would
   * silently suppress notifications for a screen nobody has open.
   */
  plansListFocused: boolean;
}


const initialState: UiState = {
  messageKey: null,
  tone: "info",
  nonce: 0,
  plansListFocused: false,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    showToast: (state, action: PayloadAction<{ messageKey: string; tone?: ToastTone }>) => {
      state.messageKey = action.payload.messageKey;
      state.tone = action.payload.tone ?? "info";
      state.nonce += 1;
    },
    hideToast: (state) => {
      state.messageKey = null;
    },
    /** Set from the plans list's focus effect, cleared when it blurs. */
    plansListFocusChanged: (state, action: PayloadAction<boolean>) => {
      state.plansListFocused = action.payload;
    },
  },
});

export const { showToast, hideToast, plansListFocusChanged } = uiSlice.actions;

export default uiSlice.reducer;
