/**
 * @author Jemilin Beulah
 */
import type { Role } from "@/api/identity";

export interface NavItem {
  to: string;
  label: string;
  roles: readonly Role[];
}

/**
 * The whole navigation, with the roles each item is for.
 *
 * Kept as data in one place so "who can see what" is reviewable at a glance rather than
 * scattered through conditional JSX. Routes are added here as features land.
 *
 * This hides items a role has no use for; it is not a security control. Every one of these
 * destinations is enforced server-side, because a hidden link is only hidden — the URL is
 * still typeable.
 */
export const NAVIGATION: readonly NavItem[] = [
  { to: "/", label: "Live Board", roles: ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"] },
  { to: "/shifts", label: "Shifts & Tasks", roles: ["SUPERVISOR", "SAFETY_MANAGER", "ADMIN"] },
  { to: "/approvals", label: "Approvals", roles: ["SUPERVISOR", "SAFETY_MANAGER"] },
  { to: "/audit", label: "Audit Trail", roles: ["SAFETY_MANAGER", "ADMIN"] },
  { to: "/settings", label: "Settings", roles: ["ADMIN"] },
  { to: "/conditions", label: "Weather Conditions", roles: ["SUPERVISOR", "SAFETY_MANAGER", "ADMIN"] },
];

export function navigationFor(role: Role): NavItem[] {
  return NAVIGATION.filter((item) => item.roles.includes(role));
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
