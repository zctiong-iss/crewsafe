/**
 * One root persist config with an explicit allowlist, plus one nested config where the
 * allowlist has to be finer than a whole slice.
 *
 * The allowlist is the point. With the reference app's per-slice wrappers, persisting a new
 * slice is the default-on outcome of writing it; here a slice is in-memory until someone
 * adds it and has to justify it in review. That matters most for the thing we need to keep
 * *out* of AsyncStorage entirely — the session, which lives in SecureStore instead
 * (`api/tokenStore.ts`).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createMigrate, type PersistConfig } from "redux-persist";
import { initialPreferencesState } from "../reducers/preferencesSlice";

/**
 * Bumped when a persisted slice's shape changes incompatibly. Without a bump, a rehydrate
 * merges yesterday's shape into today's reducer and produces state that no code path can
 * produce — the hardest kind of bug to reproduce, because it only exists on devices that
 * upgraded rather than installed fresh.
 */
const PERSIST_VERSION = 2;

export const persistConfig: Omit<PersistConfig<any>, "storage"> & {
  storage: typeof AsyncStorage;
} = {
  key: "crewsafe.root",
  version: PERSIST_VERSION,
  storage: AsyncStorage,

  /*
   * v1 → v2 added the dispatch inbox and, in the preferences slice, `reduceMotion`.
   *
   * The inbox needs nothing: it was not persisted at v1, so it starts at its initial state.
   * Preferences do, and this is the part that is easy to miss. redux-persist's default
   * reconciler merges one level deep — each slice is *replaced* by what was stored, not
   * merged field by field. A device that saved preferences before `reduceMotion` existed
   * would rehydrate with that key simply absent, so the setting would read `undefined`
   * rather than `false`. It happens to be falsy, so nothing breaks today; the first
   * preference whose default is `true` would break silently on every upgraded install and
   * work perfectly on every fresh one, which is the worst kind of bug to be handed.
   *
   * Spreading the defaults under the stored values fixes the whole class: anything the
   * stored object has wins, anything it lacks falls back to the current default.
   */
  migrate: createMigrate({
    // Synchronous: `createMigrate` types a migration as returning state, not a promise, and
    // an `async` one type-errors even though it would resolve correctly at runtime.
    2: (state) => {
      if (!state) return state;
      const previous = state as typeof state & {
        preferences?: Partial<typeof initialPreferencesState>;
      };
      return {
        ...previous,
        preferences: { ...initialPreferencesState, ...(previous.preferences ?? {}) },
      };
    },
  }),

  /*
   * What survives a restart, and why:
   *
   *   preferences    Language, font size, high contrast, reduce motion. A worker who set the
   *                  app up for sunlight must not have to do it again every morning.
   *
   * What deliberately does NOT:
   *
   *   auth           Role and site membership are revocable server-side. Re-fetched from
   *                  GET /api/v1/me on every launch so a revoked supervisor does not keep
   *                  seeing supervisor tools. Tokens are in SecureStore, not here.
   *
   *   safety         Has a validity window. Rehydrating yesterday's stop-work warning would
   *                  be worse than showing nothing.
   *
   *   profile        Avatar URIs, keyed by user id. Persisted so a photo survives a restart;
   *                  keyed so it never resolves for anyone but the person who set it. See
   *                  the note in `profileSlice` on why a face cannot be device-level the
   *                  way high contrast is.
   *
   *   dispatchInbox  Handled by the nested config below — this slice needs field-level
   *                  granularity that a slice-level allowlist cannot express.
   */
  whitelist: ["preferences", "profile"],
};

/**
 * The inbox persists two fields and no others.
 *
 * A slice-level entry in the root allowlist would drag along everything, and two of those
 * fields are actively harmful across a restart:
 *
 *   pending    The server's PENDING list at the moment the app was killed. Rehydrating it
 *              shows actions that may since have been withdrawn or completed — stale
 *              instructions presented as current, on a safety screen.
 *   inFlight   Dispatch ids with a request in flight. A process killed mid-acknowledgement
 *              would come back with a card spinning forever against a request that no
 *              longer exists.
 *
 * What does survive is the pair SCRUM-186 asks for and SCRUM-130 will need:
 *
 *   idempotencyKeys  So a retry after a kill replays rather than writes again.
 *   acknowledged     So an acknowledged action still renders as acknowledged, even though
 *                    the server's PENDING-only query no longer returns it.
 */
export const dispatchInboxPersistConfig = {
  key: "crewsafe.dispatchInbox",
  version: PERSIST_VERSION,
  storage: AsyncStorage,
  whitelist: ["idempotencyKeys", "acknowledged"],
};
