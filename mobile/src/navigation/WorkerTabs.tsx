/**
 * What a WORKER sees. Also the home of the Alerts badge poll, which lives here rather
 * than on the Inbox screen so the count stays current from any tab (SCRUM-208).
 *
 * @author Justin Chua
 */
import { useCallback } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { InboxStack, MyShiftStack, ProfileStack, WeatherStack } from "./stacks";
import { tabScreenOptions } from "./tabOptions";
import AlertsTabIcon from "@/components/inbox/AlertsTabIcon";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  loadInbox,
  selectAllAcknowledged,
  selectUnacknowledgedCount,
} from "@/store/reducers/dispatchInboxSlice";
import { useForegroundRefresh } from "@/hooks/useForegroundRefresh";
import { REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { useTheme } from "@/theme/ThemeProvider";
import type { WorkerTabParamList } from "./types";

const Tab = createBottomTabNavigator<WorkerTabParamList>();

type TabIconProps = { color: string; size: number };
const ShiftIcon = ({ color, size }: TabIconProps) => <Ionicons name="today" size={size} color={color} />;
const WorkerWeatherIcon = ({ color, size }: TabIconProps) => <Ionicons name="partly-sunny" size={size} color={color} />;
const WorkerProfileIcon = ({ color, size }: TabIconProps) => <Ionicons name="person" size={size} color={color} />;
const WorkerAlertsIcon = ({ color, size }: TabIconProps) => {
  const allAcknowledged = useAppSelector(selectAllAcknowledged);
  return <AlertsTabIcon color={color} size={size} allAcknowledged={allAcknowledged} />;
};

/**
 * What a WORKER sees. Their own shift, the actions dispatched to them, the weather, and
 * their settings — nothing that would 403.
 *
 * ── WHY THE DISPATCH POLL LIVES HERE (SCRUM-208) ────────────────────────────────────────
 * The Alerts badge counts outstanding actions and is drawn on the tab bar, so it is visible
 * while the worker is on any of these four screens. Polling inside `InboxScreen` — which is
 * what `useAutoRefresh` would do — means the count only updates while the worker is already
 * looking at Alerts, so a newly dispatched action would not appear on the badge until they
 * opened the very screen the badge exists to send them to.
 *
 * So this one poll is hoisted to the tab tree and runs while the app is in the foreground,
 * whichever tab is in front. It is a deliberate exception to the battery rule the other
 * screens follow, taken because the alternative is a badge that cannot meet the story's
 * "within 60 seconds" NFR from anywhere but Alerts itself. Weather and shifts stay
 * focus-gated: neither drives anything visible from another screen.
 */
export default function WorkerTabs() {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const outstanding = useAppSelector(selectUnacknowledgedCount);
  const allAcknowledged = useAppSelector(selectAllAcknowledged);

  useForegroundRefresh(
    useCallback(() => {
      if (!user) return;
      void dispatch(loadInbox({ workerId: user.id }));
    }, [dispatch, user]),
    REFRESH_INTERVALS.INBOX_MS,
  );

  /*
   * The Alerts tab's spoken label, resolved as a flat sequence rather than a chained
   * conditional inside the options object.
   *
   * Three states, and each one reads as its own sentence here: outstanding work, everything
   * done, or nothing to say. Nesting them as ternaries put the least important case at the
   * deepest indent and made the whole thing one expression to be parsed backwards.
   */
  const alertsLabel = (() => {
    if (outstanding > 0) return t("tabs.alertsA11yCount", { count: outstanding });
    if (allAcknowledged) return t("tabs.alertsA11yAllDone");
    return t("tabs.alerts");
  })();

  return (
    <Tab.Navigator screenOptions={tabScreenOptions(theme)}>
      <Tab.Screen
        name="MyShiftTab"
        component={MyShiftStack}
        options={{
          title: t("tabs.shift"),
          tabBarIcon: ShiftIcon,
        }}
      />
      <Tab.Screen
        name="InboxTab"
        component={InboxStack}
        options={{
          title: t("tabs.alerts"),
          tabBarIcon: WorkerAlertsIcon,
          // Only when something is outstanding. A badge showing "0" would be a permanent
          // marker that reads as "you have something", which is the opposite of the truth.
          tabBarBadge: outstanding > 0 ? outstanding : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.danger,
            color: theme.colors.textInverse,
          },
          /*
           * The count in words, because the badge alone cannot carry it.
           *
           * A small numeral on a tab icon is the first thing to disappear in glare — the
           * operating condition this app is built for — and it is invisible to a screen
           * reader entirely. The badge is the fast version; this is the one that always
           * works.
           */
          tabBarAccessibilityLabel: alertsLabel,
        }}
      />
      <Tab.Screen
        name="WeatherTab"
        component={WeatherStack}
        options={{
          title: t("tabs.weather"),
          tabBarIcon: WorkerWeatherIcon,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          title: t("tabs.profile"),
          tabBarIcon: WorkerProfileIcon,
        }}
      />
    </Tab.Navigator>
  );
}
