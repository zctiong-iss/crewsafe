/**
 * What a SUPERVISOR, SAFETY_MANAGER or ADMIN sees. No My shift and no Alerts —
 * `/shifts/me` is scoped to the caller's own assignment and the dispatch inbox is
 * WORKER-only, so both would be dead ends rather than merely empty.
 *
 * @author Justin Chua
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ProfileStack, RecommendationsStack, ShiftsStack, WeatherStack } from "./stacks";
import { tabScreenOptions } from "./tabOptions";
import { useTheme } from "@/theme/ThemeProvider";
import type { SupervisorTabParamList } from "./types";

const Tab = createBottomTabNavigator<SupervisorTabParamList>();

/**
 * What a SUPERVISOR, SAFETY_MANAGER or ADMIN sees.
 *
 * No "My shift" or "Inbox": both are worker surfaces. `GET /api/v1/shifts/me` resolves the
 * caller's own assignment and 403s for a non-WORKER, and the dispatch inbox is likewise
 * WORKER-only — so those tabs would be dead ends for this role rather than merely empty.
 */
export default function SupervisorTabs() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tab.Navigator screenOptions={tabScreenOptions(theme)}>
      <Tab.Screen
        name="ShiftsTab"
        component={ShiftsStack}
        options={{
          title: t("tabs.shifts"),
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      {/* Second, not last: a plan waiting on a decision is the most time-sensitive thing this
          role holds, and burying it behind Weather would make it the tab nobody opens. */}
      <Tab.Screen
        name="RecommendationsTab"
        component={RecommendationsStack}
        options={{
          title: t("recommendations.tabTitle"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="WeatherTab"
        component={WeatherStack}
        options={{
          title: t("tabs.weather"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="partly-sunny" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          title: t("tabs.profile"),
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}
