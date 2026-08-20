/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { draftedAgo, draftedAbsolute } from "./formatDraftedAt";

// A fixed "now" so every relative bucket is deterministic, independent of the wall clock.
const NOW = new Date("2026-08-21T12:00:00Z").getTime();
const ago = (isoDrafted: string) => draftedAgo(isoDrafted, NOW);

describe("draftedAgo", () => {
  it("floors anything under a minute to 'just now'", () => {
    expect(ago("2026-08-21T11:59:30Z")).toBe("just now");
  });

  it("reports whole minutes within the hour", () => {
    expect(ago("2026-08-21T11:45:00Z")).toBe("15 minutes ago");
  });

  it("reports whole hours within the day", () => {
    expect(ago("2026-08-21T09:00:00Z")).toBe("3 hours ago");
  });

  it("says 'yesterday' for one day (numeric:auto idiom)", () => {
    expect(ago("2026-08-20T12:00:00Z")).toBe("yesterday");
  });

  it("reports whole days beyond that", () => {
    expect(ago("2026-08-15T12:00:00Z")).toBe("6 days ago");
  });

  it("never claims a future draft — a skewed timestamp reads 'just now'", () => {
    expect(ago("2026-08-21T12:05:00Z")).toBe("just now");
  });
});

describe("draftedAbsolute", () => {
  it("renders a clear DD MMM YYYY date and 24h time in the site zone", () => {
    // 13:58 UTC is 21:58 in Singapore (+08); assert the SGT wall time, not UTC. No weekday clutter.
    const out = draftedAbsolute("2026-08-15T13:58:00Z");
    expect(out).toBe("15 Aug 2026, 21:58");
  });
});
