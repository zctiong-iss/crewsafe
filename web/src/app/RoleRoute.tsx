/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { Role } from "@/api/identity";
import { useCurrentUser } from "@/auth/useAuth";

export function RoleRoute({ roles, children }: { roles: readonly Role[]; children: ReactNode }) {
  const user = useCurrentUser();
  return roles.includes(user.role) ? children : <Navigate to="/" replace />;
}
