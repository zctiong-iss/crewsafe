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
import { ConcernsStack, ProfileStack, ShiftsStack, WeatherStack } from "./stacks";
import { tabScreenOptions } from "./tabOptions";
import { useTheme } from "@/theme/ThemeProvider";
import { useAppSelector } from "@/store/hooks";
import { loadConcerns, selectOpenConcernCount } from "@/store/reducers/wellbeingSlice";
import { useAppDispatch } from "@/store/hooks";
import { useEffect } from "react";
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

  /* US-11: how many concerns nobody has looked at yet. */
  const openConcerns = useAppSelector(selectOpenConcernCount);
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const siteId = useAppSelector((state) => state.shifts.selectedSiteId) ?? user?.siteIds[0] ?? null;

  /*
   * Loaded here rather than only on the Concerns screen, because the badge is the point: a count
   * that appears only after you open the tab tells you nothing you did not already know by
   * opening it. The screen refreshes on its own once entered; this is what makes the tab bar
   * honest before then.
   */
  useEffect(() => {
    if (!siteId) return;
    void dispatch(loadConcerns({ siteId }));
  }, [dispatch, siteId]);

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
      {/* Second, before Weather: a worker saying they feel unwell in the heat outranks the
          forecast that caused it. */}
      <Tab.Screen
        name="ConcernsTab"
        component={ConcernsStack}
        options={{
          title: t("wellbeing.concernsTab"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="medkit" size={size} color={color} />
          ),
          // Only when something is outstanding — a badge showing "0" reads as "you have
          // something", which is the opposite of the truth.
          tabBarBadge: openConcerns > 0 ? openConcerns : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.danger,
            color: theme.colors.textInverse,
          },
          /* The count in words as well as a numeral: a small badge is the first thing to
             disappear in glare, and it is invisible to a screen reader entirely. */
          tabBarAccessibilityLabel:
            openConcerns > 0
              ? `${t("wellbeing.concernsTab")}, ${t("wellbeing.concernOpen")}: ${openConcerns}`
              : t("wellbeing.concernsTab"),
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
