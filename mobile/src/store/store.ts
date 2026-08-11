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

const rootReducer = combineReducers({
  preferences,
  auth,
  safety,
  weather,
  shifts,
  // Not persisted: a decision is recorded server-side, and a stale pending item rehydrated
  // from disk would invite a supervisor to decide something already decided.
  recommendations,
  ui,
  profile,
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
    }),
});

export const persistor = persistStore(store);

export type AppDispatch = typeof store.dispatch;
