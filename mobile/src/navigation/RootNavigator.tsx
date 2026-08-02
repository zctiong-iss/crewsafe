/**
 * Chooses what the app shows, from one auth status.
 *
 * Conditional rendering rather than `navigation.navigate` after login — the reference app
 * navigates imperatively, which leaves the sign-in screen on the back stack and lets an
 * Android back gesture return to it while signed in. Swapping the navigator instead means
 * the signed-out tree stops existing, so there is nothing to go back to.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import AuthStack from "./AuthStack";
import WorkerTabs from "./WorkerTabs";
import SupervisorTabs from "./SupervisorTabs";
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
  const elevated = role === "SUPERVISOR" || role === "SAFETY_MANAGER" || role === "ADMIN";
  return elevated ? <SupervisorTabs /> : <WorkerTabs />;
}
