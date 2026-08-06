/**
 * Wires the API client to the session, once, at startup.
 *
 * The client deliberately knows nothing about Redux or SecureStore — it asks for a token
 * through an injected provider (`api/client.ts`). This module is the only place those two
 * halves meet, which is what keeps `client.ts` importable from the auth slice without a
 * cycle.
 *
 * @author Justin Chua
 */
import { setTokenProvider, setUnauthenticatedHandler } from "@/api/client";
import { isExpired, loadSession } from "@/api/tokenStore";
import { sessionExpired } from "@/store/reducers/authSlice";
import { store } from "@/store/store";

export function installSessionBridge(): void {
  setTokenProvider(async () => {
    const session = await loadSession();
    // An expired token is worse than none: sending it produces a 401 that the app would
    // have to interpret, when it already knows the session is stale.
    if (!session || isExpired(session)) return null;
    return session.accessToken;
  });

  // The server rejected a token we believed was good — revoked, or the pool was swapped
  // underneath us. Tear the session down, including the stored token, rather than leaving
  // the user tapping a UI whose every request now 401s. Never fires for a 403, and never
  // for the identity lookup — see the interceptor in `api/client.ts`.
  setUnauthenticatedHandler(() => {
    void store.dispatch(sessionExpired());
  });
}
