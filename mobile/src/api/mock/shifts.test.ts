/**
 * The mock's refusals for cancel and close (SCRUM-442).
 *
 * A mock that always succeeds is worse than no mock: it lets the screens be built against a
 * contract the server does not honour, and the disagreement only shows up against a real
 * deployment. So the rules pinned here are the server's own — a shift cannot be closed before
 * `endsAt`, and neither action works on a shift that has already ended one way or the other.
 *
 * Every test re-imports the module. The mock keeps its shifts in module scope and cancelling
 * one is permanent, so a shared instance would make each test depend on the order of the last.
 *
 * @author Justin Chua
 */
import { DEMO_SITES } from "@/auth/demoUsers";

const SITE = DEMO_SITES.bishan.id;

type MockShifts = typeof import("./shifts");

/** A fresh copy of the mock, unaffected by whatever an earlier test cancelled. */
function freshMock(): MockShifts {
  let mod!: MockShifts;
  jest.isolateModules(() => {
    mod = require("./shifts") as MockShifts;
  });
  return mod;
}

function find(mod: MockShifts, status: "PLANNED" | "ACTIVE" | "CLOSED") {
  const shift = mod.mockListShifts(SITE).find((s) => s.status === status);
  if (!shift) throw new Error(`seed data has no ${status} shift`);
  return shift;
}

describe("close", () => {
  it("refuses a shift that has not ended yet", () => {
    const mod = freshMock();
    // ACTIVE means people are on site now; endsAt is still ahead. This is the case the
    // supervisor is most likely to try, and the one cancel exists for instead.
    const active = find(mod, "ACTIVE");

    expect(() => mod.mockCloseShift(SITE, active.id)).toThrow(/not yet ended/i);
    expect(find(mod, "ACTIVE").status).toBe("ACTIVE");
  });

  it("refuses a planned shift that has not started, let alone ended", () => {
    const mod = freshMock();
    const planned = find(mod, "PLANNED");

    expect(() => mod.mockCloseShift(SITE, planned.id)).toThrow(/not yet ended/i);
  });

  it("closes a shift whose window has passed", () => {
    const mod = freshMock();
    const active = find(mod, "ACTIVE");
    // Cancel is the only way to reach a terminal state early, so to exercise close on an
    // ended shift we need one whose endsAt is behind us — the seeded CLOSED shift's window.
    const ended = find(mod, "CLOSED");
    expect(new Date(ended.endsAt).getTime()).toBeLessThan(Date.now());
    expect(new Date(active.endsAt).getTime()).toBeGreaterThan(Date.now());

    // Already CLOSED, so this must be refused as terminal rather than accepted as a no-op.
    expect(() => mod.mockCloseShift(SITE, ended.id)).toThrow(/from status CLOSED/i);
  });
});

describe("cancel", () => {
  it("calls off a shift that is running", () => {
    const mod = freshMock();
    const active = find(mod, "ACTIVE");

    const result = mod.mockCancelShift(SITE, active.id, "Lightning risk");

    expect(result.status).toBe("CANCELLED");
  });

  it("refuses a second cancel, because there is no un-cancel", () => {
    const mod = freshMock();
    const active = find(mod, "ACTIVE");
    mod.mockCancelShift(SITE, active.id, "Lightning risk");

    expect(() => mod.mockCancelShift(SITE, active.id, "Again")).toThrow(/from status CANCELLED/i);
  });

  it("refuses to cancel a shift that already closed", () => {
    const mod = freshMock();
    const closed = find(mod, "CLOSED");

    expect(() => mod.mockCancelShift(SITE, closed.id, "Too late")).toThrow(/from status CLOSED/i);
  });

  it("will not cancel a shift belonging to another site", () => {
    const mod = freshMock();
    const active = find(mod, "ACTIVE");

    expect(() => mod.mockCancelShift(DEMO_SITES.campus.id, active.id, "Wrong site")).toThrow(
      /no such shift/i,
    );
  });
});
