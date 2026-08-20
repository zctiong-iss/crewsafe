/** @author Jemilin Beulah, Tang Chee Seng */
import type { Role } from "@/api/identity";

// An administrator's job is running the system (site + user administration), not crew
// operations — even though several backend endpoints still grant ADMIN broader access for
// consistency/bypass reasons (see SiteAccessEvaluator, PolicyVersionController), the frontend
// deliberately does not route an administrator into any of those operational screens.
const OPERATIONAL_ROLES: readonly Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER"];
const MANAGEMENT_ROLES: readonly Role[] = ["SUPERVISOR", "SAFETY_MANAGER"];
const POLICY_WRITE_ROLES: readonly Role[] = ["SAFETY_MANAGER"];
const ADMIN_ROLES: readonly Role[] = ["ADMIN"];

export const ROUTE_ACCESS: Readonly<Record<string, readonly Role[]>> = {
  "/": OPERATIONAL_ROLES,
  "/shifts": OPERATIONAL_ROLES,
  "/shifts/new": MANAGEMENT_ROLES,
  "/shifts/:shiftId/edit": MANAGEMENT_ROLES,
  "/conditions": MANAGEMENT_ROLES,
  // Live action-dispatch board (US-12): the web side of the mobile ack loop. Same audience as
  // /conditions — SUPERVISOR + SAFETY_MANAGER. The backend also grants ADMIN, but an
  // administrator's UI is scoped to the admin console alone (see the note at the top of this
  // file); the server stays the real gate, so this is defense-in-depth, not the control.
  "/monitoring": MANAGEMENT_ROLES,
  // Supervisor tool: "so I can follow up before the shift begins" — SUPERVISOR + SAFETY_MANAGER + ADMIN.
  "/readiness": MANAGEMENT_ROLES,
  // Manager evidence dashboard (EP-07): inspector-facing compliance/response-time summaries.
  // SAFETY_MANAGER only — an administrator's UI is scoped to the admin console alone (see the
  // note at the top of this file).
  "/insights": ["SAFETY_MANAGER"],
  // Same audience as /conditions, which carries the derived stop-work banner this tab's
  // history table backs — a worker already gets this state via the mobile shift screen.
  "/lightning": MANAGEMENT_ROLES,
  "/approvals": ["SUPERVISOR", "SAFETY_MANAGER"],
  "/audit": ["SAFETY_MANAGER"],
  // Admin console (US-30): site + local user/role/site-membership management. The only
  // screens an administrator's UI offers at all.
  "/settings": ADMIN_ROLES,
  "/settings/sites/new": ADMIN_ROLES,
  "/settings/users": ADMIN_ROLES,
  "/settings/users/new": ADMIN_ROLES,
  "/policy": MANAGEMENT_ROLES,
  "/policy/new": POLICY_WRITE_ROLES,
};

export function rolesForRoute(path: string): readonly Role[] {
  return ROUTE_ACCESS[path] ?? [];
}
