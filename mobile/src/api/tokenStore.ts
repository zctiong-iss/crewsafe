/**
 * Where the session lives.
 *
 * Tokens go to `expo-secure-store` (iOS Keychain / Android Keystore), never to
 * AsyncStorage and never into Redux. This is the one deliberate divergence from the
 * reference app, which persists everything through redux-persist: AsyncStorage is
 * unencrypted plaintext on the device, readable by anything with filesystem access on a
 * rooted or jailbroken phone, and a bearer token there outlives the app session. The web
 * app reasons the same way in ADR 0005 and lands on sessionStorage for the same reason —
 * the strongest store the platform offers without forcing a re-login on every restart.
 *
 * The consequence to remember: Redux holds *who you are*, SecureStore holds *proof of it*.
 * Rehydrating one without the other is what `restoreSession` in the auth slice is for.
 *
 * @author Justin Chua
 */
import * as SecureStore from "expo-secure-store";
import { IS_WEB } from "@/constants/constants";

const ACCESS_TOKEN_KEY = "crewsafe.accessToken";
const REFRESH_TOKEN_KEY = "crewsafe.refreshToken";
const EXPIRES_AT_KEY = "crewsafe.expiresAt";

export interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/*
 * expo-secure-store has no web implementation — it throws on import-time use in a browser.
 * Expo web is a supported dev target here (it is the only place the PKCE flow runs without
 * a native build), so web falls back to sessionStorage: tab-scoped, cleared on close, and
 * the same trade-off ADR 0005 documents for the web console. Never used on a device.
 */
const webStore = {
  get: (key: string) =>
    typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key),
  set: (key: string, value: string) => {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
  },
  remove: (key: string) => {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
  },
};

async function getItem(key: string): Promise<string | null> {
  if (IS_WEB) return webStore.get(key);
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (IS_WEB) return webStore.set(key, value);
  return SecureStore.setItemAsync(key, value);
}

async function removeItem(key: string): Promise<void> {
  if (IS_WEB) return webStore.remove(key);
  return SecureStore.deleteItemAsync(key);
}

export async function saveSession(session: StoredSession): Promise<void> {
  await setItem(ACCESS_TOKEN_KEY, session.accessToken);
  await setItem(EXPIRES_AT_KEY, String(session.expiresAt));
  if (session.refreshToken) {
    await setItem(REFRESH_TOKEN_KEY, session.refreshToken);
  } else {
    await removeItem(REFRESH_TOKEN_KEY);
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  const accessToken = await getItem(ACCESS_TOKEN_KEY);
  const expiresAtRaw = await getItem(EXPIRES_AT_KEY);
  if (!accessToken || !expiresAtRaw) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return null;

  return {
    accessToken,
    refreshToken: await getItem(REFRESH_TOKEN_KEY),
    expiresAt,
  };
}

export async function clearSession(): Promise<void> {
  await removeItem(ACCESS_TOKEN_KEY);
  await removeItem(REFRESH_TOKEN_KEY);
  await removeItem(EXPIRES_AT_KEY);
}

/**
 * Treated as expired 30 seconds early, so a request that is in flight when the clock rolls
 * over does not arrive just after expiry and come back 401.
 */
export function isExpired(session: StoredSession, skewMs = 30_000): boolean {
  return Date.now() + skewMs >= session.expiresAt;
}
