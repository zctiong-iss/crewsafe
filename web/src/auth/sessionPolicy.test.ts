/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_TIMEOUT_MS,
  absoluteDeadlineFromAuthTime,
} from "./sessionPolicy";

describe("absoluteDeadlineFromAuthTime", () => {
  it("anchors the deadline to Cognito auth_time", () => {
    const authenticatedAt = Date.UTC(2026, 7, 10, 0, 0, 0);
    expect(
      absoluteDeadlineFromAuthTime(authenticatedAt / 1_000, authenticatedAt + 60_000),
    ).toBe(authenticatedAt + ABSOLUTE_TIMEOUT_MS);
  });

  it.each([undefined, "123", Number.NaN, -1])("rejects invalid auth_time %p", (value) => {
    expect(absoluteDeadlineFromAuthTime(value, Date.now())).toBeNull();
  });

  it("rejects an auth_time too far in the future", () => {
    const now = Date.UTC(2026, 7, 10);
    expect(absoluteDeadlineFromAuthTime((now + 6 * 60_000) / 1_000, now)).toBeNull();
  });
});
