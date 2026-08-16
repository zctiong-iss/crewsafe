/**
 * @author Jemilin Beulah
 */
import { describe, expect, it } from "vitest";
import { navigationFor, NAVIGATION } from "./navigation";
import type { Role } from "@/api/identity";

/**
 * Who sees which sections.
 *
 * Navigation is presentation, not security — every destination is enforced server-side, and
 * a hidden link is still a typeable URL. What these tests protect is the product decision:
 * a worker opening the console should not be shown an approvals queue they can never act on.
 */
describe("navigation", () => {
  it("gives every role somewhere to land", () => {
    const roles: Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];
    for (const role of roles) {
      expect(navigationFor(role).length).toBeGreaterThan(0);
    }
  });

   it("gives a worker access to live board and shifts", () => {
    expect(navigationFor("WORKER").map((item) => item.to)).toEqual(["/", "/shifts"]);
  });
  
  it("does not offer approvals to a worker or an administrator", () => {
    expect(navigationFor("WORKER").some((item) => item.to === "/approvals")).toBe(false);
    // Administration is about running the system, not signing off crew safety plans.
    expect(navigationFor("ADMIN").some((item) => item.to === "/approvals")).toBe(false);
  });

  it("gives supervisors the approvals queue", () => {
    expect(navigationFor("SUPERVISOR").some((item) => item.to === "/approvals")).toBe(true);
  });

  it("restricts settings to administrators", () => {
    const withSettings = (["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"] as Role[]).filter(
      (role) => navigationFor(role).some((item) => item.to === "/settings"),
    );
    expect(withSettings).toEqual(["ADMIN"]);
  });

  it("gives every non-worker role the heat policy catalogue, but not a worker", () => {
    const withPolicy = (["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"] as Role[]).filter(
      (role) => navigationFor(role).some((item) => item.to === "/policy"),
    );
    expect(withPolicy).toEqual(["SUPERVISOR", "SAFETY_MANAGER", "ADMIN"]);
  });

  it("has no route that no role can reach", () => {
    const roles: Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];
    const reachable = new Set(roles.flatMap((role) => navigationFor(role).map((item) => item.to)));

    for (const item of NAVIGATION) {
      expect(reachable.has(item.to)).toBe(true);
    }
  });
});
