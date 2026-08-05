/**
 * The rest/dwell deadline rules (SCRUM-206, SCRUM-207).
 *
 * These are the highest-consequence pure functions in the app: they decide when a rest is
 * over and when a card stops being shown. The cases below are the ones where being wrong is
 * silent — an anchored pattern that quietly matches a policy rule, or a malformed code that
 * starts a countdown to a number nobody chose.
 */
import {
  DEFAULT_DISMISS_MS,
  dismissAtFor,
  formatRemaining,
  restDeadlineFor,
  restMinutesFor,
} from "./restDuration";
import type { ActionDispatch } from "@/types/domain";

const ACK = "2026-08-05T10:00:00.000Z";
const ACK_MS = Date.parse(ACK);

function dispatchWith(overrides: Partial<ActionDispatch> = {}): ActionDispatch {
  return {
    id: "d1",
    approvalId: "a1",
    workerId: "w1",
    actionCode: "REST_15_MIN",
    instruction: null,
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: ACK,
    ...overrides,
  };
}

describe("restMinutesFor", () => {
  it.each([
    ["REST_10_MIN", 10],
    ["REST_15_MIN", 15],
    ["REST_30_MIN", 30],
  ])("reads the duration out of %s", (code, expected) => {
    expect(restMinutesFor(code)).toBe(expected);
  });

  /*
   * The anchoring case, and the reason the pattern ends in `$`.
   *
   * REST_10_MIN_HOURLY is a *policy* action from the heat plan — "rest 10 minutes every
   * hour" — with no single deadline. An unanchored pattern matches it and starts a
   * ten-minute countdown against a rule that does not have one.
   */
  it("does not match the hourly policy actions", () => {
    expect(restMinutesFor("REST_10_MIN_HOURLY")).toBeNull();
    expect(restMinutesFor("REST_15_MIN_HOURLY")).toBeNull();
  });

  it.each(["HYDRATE", "STOP_WORK", "ROTATE_TO_LIGHT_DUTY", "SOME_FUTURE_CODE", ""])(
    "returns null for %s, which is a requirement rather than a fallback",
    (code) => {
      expect(restMinutesFor(code)).toBeNull();
    },
  );

  it("rejects durations that are not plausible rests", () => {
    // Zero would complete instantly; 999 would never complete. Neither is a rest.
    expect(restMinutesFor("REST_0_MIN")).toBeNull();
    expect(restMinutesFor("REST_999_MIN")).toBeNull();
  });
});

describe("restDeadlineFor", () => {
  it("measures the parsed duration from the acknowledgement", () => {
    expect(restDeadlineFor(dispatchWith(), ACK)).toBe(ACK_MS + 15 * 60_000);
  });

  it("prefers the server's endTime over anything derived", () => {
    const serverEnd = "2026-08-05T10:07:00.000Z";
    expect(restDeadlineFor(dispatchWith({ endTime: serverEnd }), ACK)).toBe(
      Date.parse(serverEnd),
    );
  });

  it("falls back to the code when the server timestamp is unusable", () => {
    expect(restDeadlineFor(dispatchWith({ endTime: "not-a-date" }), ACK)).toBe(
      ACK_MS + 15 * 60_000,
    );
  });

  it("has no deadline for a non-rest code", () => {
    expect(restDeadlineFor(dispatchWith({ actionCode: "HYDRATE" }), ACK)).toBeNull();
  });

  it("has no deadline when the acknowledgement timestamp is unreadable", () => {
    expect(restDeadlineFor(dispatchWith(), "nonsense")).toBeNull();
  });
});

describe("dismissAtFor", () => {
  it("uses the rest deadline when there is one", () => {
    expect(dismissAtFor(dispatchWith(), ACK)).toBe(ACK_MS + 15 * 60_000);
  });

  it.each(["HYDRATE", "ROTATE_TO_LIGHT_DUTY", "SEEK_SHADE"])(
    "gives %s the three-minute dwell",
    (actionCode) => {
      expect(dismissAtFor(dispatchWith({ actionCode }), ACK)).toBe(ACK_MS + DEFAULT_DISMISS_MS);
    },
  );

  /*
   * The case worth having. The action catalogue is open-ended server-side, so an unknown
   * REST_* code will happen; without the fallback it would sit in the list forever, which is
   * the one outcome the auto-dismiss work exists to remove.
   */
  it("gives an unparseable rest code the dwell rather than leaving it forever", () => {
    expect(dismissAtFor(dispatchWith({ actionCode: "REST_999_MIN" }), ACK)).toBe(
      ACK_MS + DEFAULT_DISMISS_MS,
    );
  });

  it("returns null when the acknowledgement timestamp is unreadable, so the card stays", () => {
    // Better a card that lingers than one that vanishes at a time computed from a value we
    // could not read.
    expect(dismissAtFor(dispatchWith({ actionCode: "HYDRATE" }), "nonsense")).toBeNull();
  });
});

describe("formatRemaining", () => {
  it.each([
    [0, "0:00"],
    [1_000, "0:01"],
    [59_000, "0:59"],
    [60_000, "1:00"],
    [900_000, "15:00"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });

  it("never shows a negative remainder once the deadline has passed", () => {
    expect(formatRemaining(-5_000)).toBe("0:00");
  });

  it("rounds up, so the last partial second is not shown as zero", () => {
    // A countdown that reads 0:00 while time is still owed is the one direction the error
    // must not run.
    expect(formatRemaining(1)).toBe("0:01");
  });
});
