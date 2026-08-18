/**
 * Chooses what the app shows, from one auth status.
 *
 * Conditional rendering rather than `navigation.navigate` after login — the reference app
 * navigates imperatively, which leaves the sign-in screen on the back stack and lets an
 * Android back gesture return to it while signed in. Swapping the navigator instead means
 * the signed-out tree stops existing, so there is nothing to go back to.
 *
 * @author Justin Chua
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import AuthStack from "./AuthStack";
import WorkerTabs from "./WorkerTabs";
import SupervisorTabs from "./SupervisorTabs";
import SafetyManagerTabs from "./SafetyManagerTabs";
import AppLoader from "@/components/feedback/AppLoader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { restoreSession } from "@/store/reducers/authSlice";

export default function RootNavigator() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const status = useAppSelector((state) => state.auth.status);
  const role = useAppSelector((state) => state.auth.user?.role);

  // Read SecureStore once, then resolve whatever it held against GET /api/v1/me.
  useEffect(() => {
    void dispatch(restoreSession());
  }, [dispatch]);

  if (status === "starting") {
    return <AppLoader fullscreen message={t("common.loading")} />;
  }

  if (status !== "signed-in") {
    // "failed" and "not-provisioned" also land here: both are states the sign-in screen
    // explains and offers a retry for, and neither is a session.
    return <AuthStack />;
  }

  /*
   * Role decides the tab set, and the test is written as an allow-list on purpose.
   *
   * `role === "WORKER" ? worker : supervisor` reads the same but fails the wrong way: an
   * unrecognised role — a value added to the backend enum that this build predates, or an
   * undefined slipping through — would land on the supervisor surface, offering shift
   * creation to someone the server will 403. Naming the elevated roles explicitly means
   * anything unknown falls back to the worker tabs, which are the least-privileged and the
   * safe default. ADMIN is included: it holds every permission a supervisor does.
   */
  /*
   * ── THE SAFETY MANAGER IS ITS OWN SURFACE NOW (SCRUM-TBD-90) ──────────────────────────
   * Until this change all three elevated roles received the identical `SupervisorTabs`, which
   * is why a safety manager saw Shifts and a Plan a shift button at all — nobody decided they
   * should, the role simply had nowhere else to go.
   *
   * A manager oversees sites they do not run, so they get Oversight in place of Shifts. The
   * client half of that is presentation only: `ShiftController`'s write endpoints refuse the
   * role outright (SCRUM-TBD-92), and that is what actually removes the access. Removing the
   * tab without the server change would have been a hidden button, not a permission.
   *
   * ADMIN deliberately stays on the supervisor tabs. It holds every permission a supervisor
   * does, including shift writes, so moving it to a read-only oversight surface would take
   * away access the server still grants — the opposite of the safety manager's case.
   */
  if (role === "SAFETY_MANAGER") return <SafetyManagerTabs />;

  const elevated = role === "SUPERVISOR" || role === "ADMIN";
  return elevated ? <SupervisorTabs /> : <WorkerTabs />;
}
