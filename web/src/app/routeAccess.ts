/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import type { Role } from "@/api/identity";

const ALL_ROLES: readonly Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];
const MANAGEMENT_ROLES: readonly Role[] = ["SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];

export const ROUTE_ACCESS: Readonly<Record<string, readonly Role[]>> = {
  "/": ALL_ROLES,
  "/shifts": ALL_ROLES,
  "/shifts/new": MANAGEMENT_ROLES,
  "/shifts/:shiftId/edit": MANAGEMENT_ROLES,
  "/conditions": MANAGEMENT_ROLES,
  "/approvals": ["SUPERVISOR", "SAFETY_MANAGER"],
  "/audit": ["SAFETY_MANAGER", "ADMIN"],
  "/settings": ["ADMIN"],
};

export function rolesForRoute(path: string): readonly Role[] {
  return ROUTE_ACCESS[path] ?? [];
}
