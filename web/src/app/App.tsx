/**
 * @author Jemilin Beulah
 */
import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "@/features/home/HomePage";
import { CallbackPage } from "@/auth/CallbackPage";
import { AuthNotice } from "@/auth/AuthNotice";
import { SignInScreen } from "@/auth/SignInScreen";
import { useAuth } from "@/auth/useAuth";
import { PlaceholderPage } from "@/features/placeholder/PlaceholderPage";
import { NAVIGATION } from "./navigation";
import { RoleRoute } from "./RoleRoute";
import { rolesForRoute } from "./routeAccess";
import { CreateShiftPage } from "@/features/shifts/CreateShiftPage";
import { ShiftsPage } from "@/features/shifts/ShiftsPage";
import { ConditionsPage } from "@/features/conditions/ConditionsPage";
import { ActionMonitoringPage } from "@/features/monitoring/ActionMonitoringPage";
import { ReadinessPage } from "@/features/readiness/ReadinessPage";
import { InsightsPage } from "@/features/insights/InsightsPage";
import { EditShiftPage } from "@/features/shifts/EditShiftPage";
import { ShiftCloseOutSummary } from "@/features/shifts/ShiftCloseOutSummary";
import { ApprovalsPage } from "@/features/approvals/ApprovalsPage";
import { PolicyPage } from "@/features/policy/PolicyPage";
import { CreatePolicyVersionPage } from "@/features/policy/CreatePolicyVersionPage";
import { LightningPage } from "@/features/lightning/LightningPage";
import { AdminSitesPage } from "@/features/admin/AdminSitesPage";
import { AdminUsersPage } from "@/features/admin/AdminUsersPage";
import { CreateSitePage } from "@/features/admin/CreateSitePage";
import { RegisterUserPage } from "@/features/admin/RegisterUserPage";
import { AuditPage } from "@/features/audit/AuditPage";
import { OversightPage } from "@/features/oversight/OversightPage";
import { SiteProvider } from "@/site/SiteProvider";

/**
 * Routes are chosen by auth state, not guarded per-route.
 *
 * A signed-out user has no routes at all beyond the callback — there is nothing behind the
 * login to deep-link into yet, and a single decision here is far harder to get wrong than a
 * guard that has to be remembered on every future route.
 */
export function App() {
  const { state, signIn, signOut, retry } = useAuth();

  // The callback must resolve regardless of auth state: it is the thing that *creates* the
  // session, and at the moment it runs the app is still signed out.
  const callbackRoute = <Route path="/callback" element={<CallbackPage />} />;

  switch (state.status) {
    case "starting":
      return (
        <Routes>
          {callbackRoute}
          <Route
            path="*"
            element={<AuthNotice title="Starting CrewSafe" body="Checking your session." busy />}
          />
        </Routes>
      );

    case "signed-out":
      return (
        <Routes>
          {callbackRoute}
          <Route path="*" element={<SignInScreen onSignIn={signIn} />} />
        </Routes>
      );

    case "not-provisioned":
      return (
        <Routes>
          {callbackRoute}
          <Route
            path="*"
            element={
              <AuthNotice
                tone="warning"
                title="Account not set up yet"
                body="Your sign-in worked, but this account has not been added to CrewSafe. Ask your site administrator to set you up, then check again."
                action={{ label: "Check again", onClick: () => void retry() }}
                secondary={{ label: "Sign out", onClick: () => void signOut() }}
                reference={state.requestId}
              />
            }
          />
        </Routes>
      );

    case "failed":
      return (
        <Routes>
          {callbackRoute}
          <Route
            path="*"
            element={
              <AuthNotice
                tone="warning"
                title={state.reason === "network" ? "Cannot reach CrewSafe" : "Something went wrong"}
                body={
                  state.reason === "network"
                    ? "Check your connection and try again. Your session is still valid."
                    : "CrewSafe could not start. Try again in a moment."
                }
                action={{ label: "Try again", onClick: () => void retry() }}
                secondary={{ label: "Sign out", onClick: () => void signOut() }}
                reference={state.requestId}
              />
            }
          />
        </Routes>
      );

    case "signed-in":
      return (
        <SiteProvider>
          <Routes>
            {callbackRoute}
            {/* fallback="/settings": every sign-in lands here first (CallbackPage always
                navigates to "/"), and an administrator — the one role not in
                rolesForRoute("/") — belongs at the admin console, not looping back to "/". */}
            <Route
              path="/"
              element={
                <RoleRoute roles={rolesForRoute("/")} fallback="/settings">
                  <HomePage />
                </RoleRoute>
              }
            />

            {/* Every nav destination resolves to something. A link that 404s reads as a bug;
                a page that says "not built yet" reads as a roadmap. */}
            {NAVIGATION.filter(
              (item) =>
                item.to !== "/" && item.to !== "/shifts" && item.to !== "/conditions" &&
                item.to !== "/monitoring" &&
                item.to !== "/audit" && item.to !== "/insights" && item.to !== "/readiness" &&
                item.to !== "/approvals" && item.to !== "/policy" && item.to !== "/lightning" &&
                item.to !== "/settings" && item.to !== "/oversight",
            ).map((item) => (
              <Route
                key={item.to}
                path={item.to}
                element={
                  <RoleRoute roles={rolesForRoute(item.to)}>
                    <PlaceholderPage title={item.label} />
                  </RoleRoute>
                }
              />
            ))}

            <Route
              path="/shifts/new"
              element={<RoleRoute roles={rolesForRoute("/shifts/new")}><CreateShiftPage /></RoleRoute>}
            />
            <Route
              path="/shifts"
              element={<RoleRoute roles={rolesForRoute("/shifts")}><ShiftsPage /></RoleRoute>}
            />
            <Route
              path="/shifts/:shiftId/edit"
              element={<RoleRoute roles={rolesForRoute("/shifts/:shiftId/edit")}><EditShiftPage /></RoleRoute>}
            />
            <Route
              path="/shifts/:shiftId/summary"
              element={<RoleRoute roles={rolesForRoute("/shifts/:shiftId/summary")}><ShiftCloseOutSummary /></RoleRoute>}
            />
            <Route
              path="/conditions"
              element={<RoleRoute roles={rolesForRoute("/conditions")}><ConditionsPage /></RoleRoute>}
            />
            <Route
              path="/monitoring"
              element={<RoleRoute roles={rolesForRoute("/monitoring")}><ActionMonitoringPage /></RoleRoute>}
            />
            <Route
              path="/readiness"
              element={<RoleRoute roles={rolesForRoute("/readiness")}><ReadinessPage /></RoleRoute>}
            />
            <Route
              path="/insights"
              element={<RoleRoute roles={rolesForRoute("/insights")}><InsightsPage /></RoleRoute>}
            />
            <Route
              path="/approvals"
              element={<RoleRoute roles={rolesForRoute("/approvals")}><ApprovalsPage /></RoleRoute>}
            />
            <Route
              path="/oversight"
              element={<RoleRoute roles={rolesForRoute("/oversight")}><OversightPage /></RoleRoute>}
            />
            <Route
              path="/policy/new"
              element={<RoleRoute roles={rolesForRoute("/policy/new")}><CreatePolicyVersionPage /></RoleRoute>}
            />
            <Route
              path="/policy"
              element={<RoleRoute roles={rolesForRoute("/policy")}><PolicyPage /></RoleRoute>}
            />
            <Route
              path="/lightning"
              element={<RoleRoute roles={rolesForRoute("/lightning")}><LightningPage /></RoleRoute>}
            />
            <Route
              path="/settings/sites/new"
              element={<RoleRoute roles={rolesForRoute("/settings/sites/new")}><CreateSitePage /></RoleRoute>}
            />
            <Route
              path="/settings/users/new"
              element={<RoleRoute roles={rolesForRoute("/settings/users/new")}><RegisterUserPage /></RoleRoute>}
            />
            <Route
              path="/settings/users"
              element={<RoleRoute roles={rolesForRoute("/settings/users")}><AdminUsersPage /></RoleRoute>}
            />
            <Route
              path="/settings"
              element={<RoleRoute roles={rolesForRoute("/settings")}><AdminSitesPage /></RoleRoute>}
            />
            <Route
              path="/audit"
              element={<RoleRoute roles={rolesForRoute("/audit")}><AuditPage /></RoleRoute>}
            />

            {/* Replace a placeholder only when its real guarded route lands in this same change. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SiteProvider>
      );
  }
}
