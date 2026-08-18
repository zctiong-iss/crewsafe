/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Role } from "@/api/identity";
import { useCurrentUser } from "@/auth/useAuth";

export function RoleRoute({
  roles,
  children,
  fallback = "/",
}: {
  roles: readonly Role[];
  children: ReactNode;
  /** Where a denied role is sent. Defaults to "/" — override only when "/" itself is the
   * route being guarded (an administrator's home is /settings, not the live board). */
  fallback?: string;
}) {
  const user = useCurrentUser();
  return roles.includes(user.role) ? children : <Navigate to={fallback} replace />;
}
