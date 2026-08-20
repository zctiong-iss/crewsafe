/**
 * @author Jemilin Beulah
 */
import type { Role } from "@/api/identity";
import { rolesForRoute } from "./routeAccess";

export interface NavItem {
  to: string;
  label: string;
}

/**
 * The whole navigation, with route access derived from the canonical route-access table.
 *
 * Kept as data in one place so "who can see what" is reviewable at a glance rather than
 * scattered through conditional JSX. Routes are added here as features land.
 *
 * This hides items a role has no use for; it is not a security control. Every one of these
 * destinations is enforced server-side, because a hidden link is only hidden — the URL is
 * still typeable.
 */
export const NAVIGATION: readonly NavItem[] = [
  { to: "/", label: "Live Board" },
  { to: "/shifts", label: "Shifts & Tasks" },
  { to: "/readiness", label: "Readiness" },
  { to: "/approvals", label: "Approvals" },
  { to: "/oversight", label: "Oversight" },
  { to: "/insights", label: "Insights" },
  { to: "/audit", label: "Audit Trail" },
  { to: "/settings", label: "Admin" },
  { to: "/conditions", label: "Weather Conditions" },
  { to: "/policy", label: "Heat Policy" },
  { to: "/lightning", label: "Lightning" },
];

export function navigationFor(role: Role): NavItem[] {
  return NAVIGATION.filter((item) => rolesForRoute(item.to).includes(role));
}

const ROLE_LABELS: Record<Role, string> = {
  WORKER: "Worker",
  SUPERVISOR: "Site supervisor",
  SAFETY_MANAGER: "Safety manager",
  ADMIN: "Administrator",
};

/** Roles are stored as WORKER; people are not called WORKER. */
export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}
