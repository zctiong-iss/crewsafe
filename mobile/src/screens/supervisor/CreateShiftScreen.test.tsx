import { isEndAfterStart } from "./CreateShiftScreen";

describe("isEndAfterStart", () => {
  it("requires an end time strictly after the start time", () => {
    const start = new Date("2026-08-18T09:00:00.000Z");

    expect(isEndAfterStart(start, start)).toBe(false);
    expect(isEndAfterStart(start, new Date("2026-08-18T09:00:01.000Z"))).toBe(true);
  });
});
