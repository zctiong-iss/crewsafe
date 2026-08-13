/**
 * api/tokenStore (SCRUM-352 / FR-003).
 *
 * SecureStore holds proof of who you are; Redux holds who you are — see the file's own
 * header comment. Asserts the save/load/clear round trip, a corrupted-on-disk expiry value
 * being treated as no session, and the 30-second-early expiry skew that protects an
 * in-flight request from arriving just after the real deadline.
 */
import * as SecureStore from "expo-secure-store";
import { clearSession, isExpired, loadSession, saveSession, type StoredSession } from "./tokenStore";

const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;
const deleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

beforeEach(() => {
  getItemAsync.mockReset().mockResolvedValue(null);
  setItemAsync.mockReset().mockResolvedValue(undefined);
  deleteItemAsync.mockReset().mockResolvedValue(undefined);
});

describe("saveSession", () => {
  it("stores the access token, expiry, and refresh token", async () => {
    await saveSession({ accessToken: "a.b.c", refreshToken: "refresh-1", expiresAt: 12345 });

    expect(setItemAsync).toHaveBeenCalledWith("crewsafe.accessToken", "a.b.c");
    expect(setItemAsync).toHaveBeenCalledWith("crewsafe.expiresAt", "12345");
    expect(setItemAsync).toHaveBeenCalledWith("crewsafe.refreshToken", "refresh-1");
  });

  it("clears any stored refresh token when the new session has none", async () => {
    await saveSession({ accessToken: "a.b.c", refreshToken: null, expiresAt: 12345 });

    expect(deleteItemAsync).toHaveBeenCalledWith("crewsafe.refreshToken");
    expect(setItemAsync).not.toHaveBeenCalledWith("crewsafe.refreshToken", expect.anything());
  });
});

describe("loadSession", () => {
  it("returns null when nothing is stored", async () => {
    await expect(loadSession()).resolves.toBeNull();
  });

  it("returns the stored session when everything is present", async () => {
    getItemAsync.mockImplementation((key: string) =>
      Promise.resolve(
        { "crewsafe.accessToken": "a.b.c", "crewsafe.expiresAt": "99999", "crewsafe.refreshToken": "r1" }[
          key
        ] ?? null,
      ),
    );

    await expect(loadSession()).resolves.toEqual({
      accessToken: "a.b.c",
      refreshToken: "r1",
      expiresAt: 99999,
    });
  });

  it("treats a corrupted (non-numeric) expiry as no session", async () => {
    getItemAsync.mockImplementation((key: string) =>
      Promise.resolve(
        { "crewsafe.accessToken": "a.b.c", "crewsafe.expiresAt": "not-a-number" }[key] ?? null,
      ),
    );

    await expect(loadSession()).resolves.toBeNull();
  });

  it("treats a missing access token as no session even if an expiry is stored", async () => {
    getItemAsync.mockImplementation((key: string) =>
      Promise.resolve({ "crewsafe.expiresAt": "99999" }[key] ?? null),
    );

    await expect(loadSession()).resolves.toBeNull();
  });
});

describe("clearSession", () => {
  it("removes all three stored values", async () => {
    await clearSession();

    expect(deleteItemAsync).toHaveBeenCalledWith("crewsafe.accessToken");
    expect(deleteItemAsync).toHaveBeenCalledWith("crewsafe.refreshToken");
    expect(deleteItemAsync).toHaveBeenCalledWith("crewsafe.expiresAt");
  });
});

describe("isExpired", () => {
  function session(expiresAt: number): StoredSession {
    return { accessToken: "a", refreshToken: null, expiresAt };
  }

  it("is false well before expiry", () => {
    expect(isExpired(session(Date.now() + 60_000))).toBe(false);
  });

  it("is true once the 30-second skew window is reached, even before the real deadline", () => {
    // A request in flight when the clock rolls over must not arrive just after expiry and
    // come back 401 — see the file's own header comment.
    expect(isExpired(session(Date.now() + 10_000))).toBe(true);
  });

  it("is true after the real deadline has passed", () => {
    expect(isExpired(session(Date.now() - 1000))).toBe(true);
  });

  it("honours a custom skew", () => {
    expect(isExpired(session(Date.now() + 10_000), 0)).toBe(false);
  });
});
