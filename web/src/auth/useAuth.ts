import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./AuthProvider";

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}

/**
 * The signed-in user, for components that only render inside the authenticated shell.
 *
 * Throws rather than returning null so that a component cannot quietly render a
 * half-populated view if it is ever mounted outside the guard.
 */
export function useCurrentUser() {
  const { state } = useAuth();
  if (state.status !== "signed-in") {
    throw new Error("useCurrentUser requires a signed-in session");
  }
  return state.user;
}
