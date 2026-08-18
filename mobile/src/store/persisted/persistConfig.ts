/**
 * One root persist config with an explicit allowlist, plus one nested config where the
 * allowlist has to be finer than a whole slice.
 *
 * The allowlist is the point. With the reference app's per-slice wrappers, persisting a new
 * slice is the default-on outcome of writing it; here a slice is in-memory until someone
 * adds it and has to justify it in review. That matters most for the thing we need to keep
 * *out* of AsyncStorage entirely — the session, which lives in SecureStore instead
 * (`api/tokenStore.ts`).
 *
 * @author Justin Chua
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
const PERSIST_VERSION = 5;

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

    /*
     * v2 → v3 flipped `reduceMotion` to on by default (SCRUM-199), while it was still a
     * single device-level boolean.
     *
     * This is the bug the v2 note predicted, arriving: the default became `true`, and the
     * spread-defaults-under-stored-values trick that fixes every other field is exactly
     * wrong for it. A device that ran v2 stored `reduceMotion: false` — not because anyone
     * chose it, but because that was the default — so letting the stored value win would
     * have left every upgraded install on the old behaviour while fresh installs got the
     * new one.
     *
     * v4 supersedes this: the field it wrote no longer exists. The migration is kept
     * because redux-persist runs the chain in order, and a device still on v1 or v2 has to
     * pass through here to reach v4. It is deliberately written against a local shape
     * rather than `initialPreferencesState`, so a future change to the current defaults
     * cannot silently alter what a historical migration does.
     */
    3: (state) => {
      if (!state) return state;
      const previous = state as typeof state & {
        preferences?: Record<string, unknown>;
      };
      return {
        ...previous,
        preferences: {
          ...(previous.preferences ?? {}),
          reduceMotion: true,
          reduceMotionChosenExplicitly: false,
        },
      };
    },

    /*
     * v3 → v4 moves reduce-motion from one device-level boolean to a per-user map.
     *
     * The device-level value is dropped rather than carried over, and there is no way to do
     * better: it records what *a* phone was set to, and this version needs to know what a
     * *person* chose. Nothing in persisted state can name that person, because `auth` is
     * deliberately not persisted — it is re-fetched from `GET /api/v1/me` on every launch so
     * a revoked role cannot linger. Attributing the old boolean to whoever happens to sign
     * in next would be a guess, and on a shared site phone it would be the specific wrong
     * guess this whole change exists to prevent.
     *
     * So every account starts as never-asked and gets the default at its next login, which
     * is exactly the intended behaviour for all of them but one — the person already using
     * this handset, who may have to set it once more. One switch, once, against a setting
     * that is otherwise silently inherited by strangers.
     *
     * Both dead fields are deleted rather than left in place. redux-persist stores whatever
     * it is handed, and a stale `reduceMotion` sitting in AsyncStorage is an invitation for
     * some later reader to find it and believe it.
     */
    4: (state) => {
      if (!state) return state;
      const previous = state as typeof state & {
        preferences?: Record<string, unknown>;
      };
      const {
        reduceMotion: _dropped,
        reduceMotionChosenExplicitly: _alsoDropped,
        ...carriedOver
      } = previous.preferences ?? {};

      return {
        ...previous,
        preferences: {
          ...initialPreferencesState,
          ...carriedOver,
          // After the spread: a v3 install has no such key, but an interrupted or replayed
          // migration must not end up merging one in.
          reduceMotionByUser: {},
        },
      };
    },

    /*
     * v4 → v5 adds the two notification preferences.
     *
     * Both default to `false`, so a device that skipped this migration would happen to
     * behave correctly — `undefined` is falsy and every read of them is a boolean test. That
     * is exactly the accident the v2 note warns about, and it is not a reason to skip the
     * migration: the next person to change one of these defaults to `true` would otherwise
     * ship a bug that works perfectly on every fresh install and fails silently on every
     * upgraded one, which is the hardest possible shape to reproduce.
     *
     * Spread under the stored values, so anything the device already chose still wins.
     */
    5: (state) => {
      if (!state) return state;
      const previous = state as typeof state & {
        preferences?: Record<string, unknown>;
      };
      return {
        ...previous,
        preferences: {
          notificationsMuted: false,
          notificationRationaleShown: false,
          ...previous.preferences,
        },
      };
    },
  }),

  /*
   * What survives a restart, and why:
   *
   *   preferences    Language, font size, high contrast, reduce motion, and whether
   *                  notifications are muted. A worker who set the app up for sunlight must
   *                  not have to do it again every morning.
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
   *   notifications  Which drafted plans this device has already announced, keyed by user id.
   *                  Persisted because it is the only thing standing between a restart and a
   *                  burst of notifications for every plan already on the site — see
   *                  `notificationsSlice` for why an empty set is the dangerous state.
   *
   *   profile        Avatar URIs, keyed by user id. Persisted so a photo survives a restart;
   *                  keyed so it never resolves for anyone but the person who set it. See
   *                  the note in `profileSlice` on why a face cannot be device-level the
   *                  way high contrast is.
   *
   *   dispatchInbox  Handled by the nested config below — this slice needs field-level
   *                  granularity that a slice-level allowlist cannot express.
   */
  whitelist: ["preferences", "profile", "notifications"],
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
 *                    the server's PENDING-only query no longer returns it. Since SCRUM-206
 *                    each record also carries its `dismissAt`, which is what lets a
 *                    fifteen-minute rest survive the app being killed instead of restarting.
 *   dismissedIds     So a card that has already run its course does not come back. Without
 *                    it, relaunching the app would resurrect every card the worker had
 *                    already seen out — the acknowledgement records survive by design, so
 *                    the list would rebuild itself from them.
 */
export const dispatchInboxPersistConfig = {
  key: "crewsafe.dispatchInbox",
  version: PERSIST_VERSION,
  storage: AsyncStorage,
  whitelist: ["idempotencyKeys", "acknowledged", "dismissedIds"],
};
