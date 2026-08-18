/**
 * Where a tapped notification takes you.
 *
 * ── WHY THIS IS NOT OPTIONAL POLISH ─────────────────────────────────────────────────────
 * A notification that opens the app's launch screen has made the user do the finding
 * themselves — and for a drafted plan, "the finding" means working out which of several
 * shifts the notification was about. At that point the notification has cost an interruption
 * and saved nothing.
 *
 * Renders nothing. It lives inside `NavigationContainer` so it can reach the navigator, and
 * outside any screen so a tap is handled whatever happens to be on top.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────
 * The rest-end notification routes nowhere. Its card has already been cleared by the time it
 * fires — that is what the rest ending means — so there is nothing to open, and dropping the
 * worker onto an empty Alerts tab would suggest something was there to look at. Tapping it
 * simply opens the app, which is what a worker checking why their phone buzzed expects.
 *
 * @author Justin Chua
 */
import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";

import { onNotificationTapped } from "./notificationClient";

export default function NotificationRouter() {
  const navigation = useNavigation();

  useEffect(() => {
    return onNotificationTapped(({ data }) => {
      if (data.kind !== "plan-drafted") return;

      const { siteId, shiftId, recommendationId } = data;

      /*
       * A batch notification carries no plan, by design — see `announceDraftedPlans`. It
       * lands on the list, which is the only screen that can show all of what it announced.
       */
      const hasTarget =
        typeof siteId === "string" &&
        typeof shiftId === "string" &&
        typeof recommendationId === "string";

      /*
       * Typed loosely on purpose.
       *
       * The tab and stack this targets only exist in a supervisor's navigator, and the root
       * navigator's type is a union across three role trees — so a precisely-typed navigate
       * here would have to assert which arm of that union is mounted, which is exactly the
       * thing that cannot be known at compile time. React Navigation no-ops on a route it
       * cannot find, so the failure mode of getting this wrong is landing on the current
       * screen rather than crashing.
       */
      const navigate = navigation.navigate as unknown as (
        screen: string,
        params?: Record<string, unknown>,
      ) => void;

      if (hasTarget) {
        navigate("RecommendationsTab", {
          screen: "RecommendationDetail",
          params: { siteId, shiftId, recommendationId },
        });
        return;
      }

      navigate("RecommendationsTab", { screen: "RecommendationList" });
    });
  }, [navigation]);

  return null;
}
