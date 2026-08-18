/**
 * Which drafted plans this device has already told the supervisor about.
 *
 * ── WHY A PERSISTED SET IS THE WHOLE DESIGN ─────────────────────────────────────────────
 * Nothing tells the client a plan was drafted. `RecommendationsScreen` polls every 60 seconds
 * against a server scheduler that runs every two minutes, so "a new plan was drafted" is only
 * ever inferred: it is a plan in the poll's answer that was not in the last one. That makes
 * the record of what has already been seen the load-bearing part of the feature, and the two
 * ways it goes wrong are both bad in a way the user notices immediately.
 *
 *   Starting EMPTY   Every plan on the site looks new on the first poll after signing in, and
 *                    the supervisor's phone fires a burst of notifications for plans drafted
 *                    last week. This is why `seed` exists as a separate action from `mark`.
 *
 *   Not PERSISTING   The burst above happens again on every app restart, which on a site
 *                    phone is several times a shift.
 *
 * ── WHY IT IS KEYED BY USER ─────────────────────────────────────────────────────────────
 * Site phones are shared. A supervisor signing in after a colleague has not been told about
 * anything, and inheriting the colleague's seen-set would silently swallow every plan drafted
 * during the previous shift — the one case where the notification would have mattered most.
 *
 * The same reasoning `profileSlice` uses for avatars and `preferencesSlice` uses for reduce
 * motion, and it carries the same caveat: entries accumulate for the life of the install, one
 * bounded list per account that has ever signed in on this handset.
 *
 * @author Justin Chua
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * How many plan ids are remembered per user.
 *
 * Bounded because this is persisted and never otherwise pruned. Generous enough that a
 * supervisor cannot poll past it within a shift — plans arrive at most every two minutes, so
 * this is several days of continuous drafting — and small enough that the stored blob stays
 * trivial. Oldest are dropped first, and a dropped id can at worst cause one duplicate
 * notification for a plan from days ago that is somehow still awaiting a decision.
 */
export const SEEN_PLAN_LIMIT = 200;

export interface NotificationsState {
  /**
   * userId → plan ids already announced to that user on this device.
   *
   * Absence of the key is the meaningful state, exactly as it is in `reduceMotionByUser`: no
   * entry means this account has never loaded plans here, and the next successful load seeds
   * rather than notifies.
   */
  seenPlanIdsByUser: Record<string, string[]>;
}

export const initialNotificationsState: NotificationsState = {
  seenPlanIdsByUser: {},
};

/** Newest-first, capped. Kept in one place so seed and mark cannot diverge on the ordering. */
function retain(existing: string[], incoming: string[]): string[] {
  const merged = [...incoming, ...existing.filter((id) => !incoming.includes(id))];
  return merged.slice(0, SEEN_PLAN_LIMIT);
}

const notificationsSlice = createSlice({
  name: "notifications",
  initialState: initialNotificationsState,
  reducers: {
    /**
     * First load for this user: record everything, announce nothing.
     *
     * Deliberately a different action from `planIdsAnnounced` even though the state change is
     * identical, because the two are asked at different moments and one of them must never
     * notify. Collapsing them into one would leave the caller's boolean the only thing
     * standing between a supervisor and a burst of notifications on sign-in — and a boolean
     * argument at a call site is a poor place for that to live.
     */
    seenPlansSeeded: (state, action: PayloadAction<{ userId: string; planIds: string[] }>) => {
      const { userId, planIds } = action.payload;
      // Seeds once. A second seed would silently discard everything announced since the
      // first, and every one of those plans would notify again on the next poll.
      if (state.seenPlanIdsByUser[userId]) return;
      state.seenPlanIdsByUser[userId] = planIds.slice(0, SEEN_PLAN_LIMIT);
    },
    /** Recorded after notifying, so the same plan never buzzes twice. */
    planIdsAnnounced: (state, action: PayloadAction<{ userId: string; planIds: string[] }>) => {
      const { userId, planIds } = action.payload;
      state.seenPlanIdsByUser[userId] = retain(state.seenPlanIdsByUser[userId] ?? [], planIds);
    },
    /** Dev only, paired with the mock reset so the flow can be replayed. */
    seenPlansCleared: (state) => {
      state.seenPlanIdsByUser = {};
    },
  },
});

export const { seenPlansSeeded, planIdsAnnounced, seenPlansCleared } = notificationsSlice.actions;

/**
 * Whether this user has ever had a successful plan load on this device.
 *
 * The question every caller actually asks, phrased so no call site has to know that absence
 * of the key is what encodes it.
 */
export function hasSeededPlans(state: NotificationsState, userId: string): boolean {
  return state.seenPlanIdsByUser[userId] !== undefined;
}

export default notificationsSlice.reducer;
