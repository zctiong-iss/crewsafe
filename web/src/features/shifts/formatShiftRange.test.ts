/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { formatShiftRange } from "./formatShiftRange";

describe("formatShiftRange", () => {
  it("a same-day shift shows the date once", () => {
    // 08:00 SGT → 16:00 SGT, both 10 Aug
    const out = formatShiftRange("2026-08-10T00:00:00Z", "2026-08-10T08:00:00Z");
    expect(out).toContain("Aug");
    expect(out.match(/Aug/g)).toHaveLength(1);   // one date, two times
  });

  it("a shift spanning midnight shows both dates", () => {
    // 21:00 SGT 10 Aug → 02:00 SGT 11 Aug — straddles midnight IN Singapore (not just UTC)
    const out = formatShiftRange("2026-08-10T13:00:00Z", "2026-08-10T18:00:00Z");
    expect(out.match(/Aug/g)).toHaveLength(2);   // two dates
  });
});
