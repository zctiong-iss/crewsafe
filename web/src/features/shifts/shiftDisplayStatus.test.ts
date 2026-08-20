import { describe, expect, it } from "vitest";
import type { Shift } from "@/api/shifts";
import { displayStatus } from "./shiftDisplayStatus";

const now = new Date("2026-08-20T12:00:00Z");

function shift(status: Shift["status"], startsAt: string, endsAt: string): Shift {
  return { id: "shift-1", siteId: "site-1", status, startsAt, endsAt, assignments: [] };
}

describe("displayStatus", () => {
  it("derives active and ended states from one explicit clock", () => {
    expect(displayStatus(shift("PLANNED", "2026-08-20T08:00:00Z", "2026-08-20T16:00:00Z"), now)).toBe("ACTIVE");
    expect(displayStatus(shift("PLANNED", "2026-08-19T08:00:00Z", "2026-08-19T16:00:00Z"), now)).toBe("ENDED");
    expect(displayStatus(shift("PLANNED", "2026-08-21T08:00:00Z", "2026-08-21T16:00:00Z"), now)).toBe("PLANNED");
  });

  it("preserves terminal backend statuses even when their time range has passed", () => {
    expect(displayStatus(shift("CLOSED", "2026-08-19T08:00:00Z", "2026-08-19T16:00:00Z"), now)).toBe("CLOSED");
    expect(displayStatus(shift("CANCELLED", "2026-08-19T08:00:00Z", "2026-08-19T16:00:00Z"), now)).toBe("CANCELLED");
  });
});
