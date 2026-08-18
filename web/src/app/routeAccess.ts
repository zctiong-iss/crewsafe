/** @author Jemilin Beulah, Tang Chee Seng */
import type { Role } from "@/api/identity";

const ALL_ROLES: readonly Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];
const MANAGEMENT_ROLES: readonly Role[] = ["SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];
const POLICY_WRITE_ROLES: readonly Role[] = ["SAFETY_MANAGER", "ADMIN"];

export const ROUTE_ACCESS: Readonly<Record<string, readonly Role[]>> = {
  "/": ALL_ROLES,
  "/shifts": ALL_ROLES,
  "/shifts/new": MANAGEMENT_ROLES,
  "/shifts/:shiftId/edit": MANAGEMENT_ROLES,
  "/conditions": MANAGEMENT_ROLES,
  // Supervisor tool: "so I can follow up before the shift begins" — SUPERVISOR + SAFETY_MANAGER + ADMIN.
  "/readiness": MANAGEMENT_ROLES,
  // Manager evidence dashboard (EP-07): inspector-facing compliance/response-time summaries.
  "/insights": ["SAFETY_MANAGER", "ADMIN"],
  // Same audience as /conditions, which carries the derived stop-work banner this tab's
  // history table backs — a worker already gets this state via the mobile shift screen.
  "/lightning": MANAGEMENT_ROLES,
  "/approvals": ["SUPERVISOR", "SAFETY_MANAGER"],
  "/audit": ["SAFETY_MANAGER", "ADMIN"],
  "/settings": ["ADMIN"],
  // Read matches PolicyVersionController's list/active endpoints (SUPERVISOR+SAFETY_MANAGER+ADMIN);
  // create matches its create/activate endpoints (SAFETY_MANAGER+ADMIN only).
  "/policy": MANAGEMENT_ROLES,
  "/policy/new": POLICY_WRITE_ROLES,
};

export function rolesForRoute(path: string): readonly Role[] {
  return ROUTE_ACCESS[path] ?? [];
}
