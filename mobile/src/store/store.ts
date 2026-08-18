/**
 * The Redux store, and the redux-persist wiring around it. Tokens are deliberately not
 * here — they live in SecureStore; see `api/tokenStore.ts`.
 *
 * @author Justin Chua
 */
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";
import { dispatchInboxPersistConfig, persistConfig } from "./persisted/persistConfig";
import preferences from "./reducers/preferencesSlice";
import auth from "./reducers/authSlice";
import safety from "./reducers/safetySlice";
import weather from "./reducers/weatherSlice";
import shifts from "./reducers/shiftsSlice";
import ui from "./reducers/uiSlice";
import profile from "./reducers/profileSlice";
import dispatchInbox from "./reducers/dispatchInboxSlice";
import recommendations from "./reducers/recommendationsSlice";
import oversight from "./reducers/oversightSlice";
import wellbeing from "./reducers/wellbeingSlice";
import policy from "./reducers/policySlice";
import forecast from "./reducers/forecastSlice";
import notifications from "./reducers/notificationsSlice";
import { notificationListener } from "./notificationListeners";

const rootReducer = combineReducers({
  preferences,
  auth,
  safety,
  weather,
  shifts,
  // Not persisted: a decision is recorded server-side, and a stale pending item rehydrated
  // from disk would invite a supervisor to decide something already decided.
  recommendations,
  // Not persisted, for the same reason as `recommendations` and more so: this is a safety
  // manager's view across many sites, and a stale plan rehydrated from disk would understate
  // how much is outstanding on a site they are about to judge.
  oversight,
  // Not persisted: a rest logged on this device is a fact the server holds, and rehydrating a
  // stale "logged at" would tell a worker they rested when the write never landed.
  wellbeing,
  // Not persisted: which rules are in force is a fact the server owns, and a stale copy
  // rehydrated from disk could show a version that was superseded while the app was closed.
  policy,
  // Not persisted: a forecast was already about the future when it was made, and rehydrating
  // one from a previous session would present a prediction whose window has long closed as
  // though it still described what is coming.
  forecast,
  ui,
  profile,
  /*
   * Persisted, via the root allowlist. It records which drafted plans this device has already
   * announced, and the whole point of it is surviving a restart: starting empty would make
   * every plan on the site look new on the next poll, and a supervisor's phone would fire a
   * burst of notifications for plans drafted days ago. See `notificationsSlice`.
   */
  notifications,
  // Nested persist: this slice needs two of its fields kept and the rest discarded. See
  // `dispatchInboxPersistConfig` for why `pending` and `inFlight` must not survive.
  dispatchInbox: persistReducer(dispatchInboxPersistConfig, dispatchInbox),
});

export type RootState = ReturnType<typeof rootReducer>;

const persistedReducer = persistReducer<RootState>(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // redux-persist dispatches these with non-serializable payloads by design.
        // Silencing the whole check instead would also silence it for our own actions,
        // which is where it actually earns its keep.
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
      /*
       * Prepended, not appended.
       *
       * A listener runs after the reducers have handled the action, and prepending puts it
       * ahead of the default middleware so it sees the action even if something later in the
       * chain swallows it. It is also where RTK's own documentation puts it, and the ordering
       * is not worth diverging from for its own sake.
       */
    }).prepend(notificationListener.middleware),
});

export const persistor = persistStore(store);

export type AppDispatch = typeof store.dispatch;
