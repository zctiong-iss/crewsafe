/**
 * mockAuth (SCRUM-352 / FR-002).
 *
 * Signs in as a fixture with no network at all — the sentinel token shape is what lets the
 * rest of the app stay unaware of the mode (see the file's own header comment). Asserts the
 * sentinel round-trip and both negative cases: an unknown demo user at sign-in, and a demo
 * user removed from the fixture list by the time a stored session is resolved.
 */
import { currentUserFromMockToken, isMockToken, mockSessionFor } from "./mockAuth";
import { AuthError } from "./AuthError";
import { DEMO_USERS } from "./demoUsers";

const KNOWN_USER = DEMO_USERS[0];

describe("isMockToken", () => {
  it("recognises the mock sentinel prefix", () => {
    expect(isMockToken(`mock.${KNOWN_USER.id}`)).toBe(true);
  });

  it("rejects a real-looking JWT", () => {
    expect(isMockToken("header.payload.signature")).toBe(false);
  });
});

describe("mockSessionFor", () => {
  it("issues a sentinel session for a known demo user", () => {
    const session = mockSessionFor(KNOWN_USER.id);

    expect(session.accessToken).toBe(`mock.${KNOWN_USER.id}`);
    expect(session.refreshToken).toBeNull();
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws for an id not in the fixture list", () => {
    expect(() => mockSessionFor("not-a-real-demo-user")).toThrow(AuthError);
  });
});

describe("currentUserFromMockToken", () => {
  it("resolves the fixture behind a valid sentinel", () => {
    const user = currentUserFromMockToken(`mock.${KNOWN_USER.id}`);
    expect(user.id).toBe(KNOWN_USER.id);
  });

  it("treats a token for a since-removed fixture as not-provisioned", () => {
    expect(() => currentUserFromMockToken("mock.no-longer-exists")).toThrow(
      expect.objectContaining({ messageKey: "errors.not-provisioned" }),
    );
  });
});
