/**
 * What a SAFETY_MANAGER sees (SCRUM-TBD-90).
 *
 * Diverges from {@link SupervisorTabs} in exactly one place: Oversight replaces Shifts. Until
 * this existed all three elevated roles received the supervisor's tabs, which is the only
 * reason a manager ever saw a Plan a shift button — nobody decided they should, the role
 * simply had nowhere else to go.
 *
 * The tab's absence is presentation only. What actually removes the access is
 * `ShiftController` refusing the role on every write endpoint (SCRUM-TBD-92); hiding a control
 * without that would be a hidden button rather than a permission.
 *
 * Plans is kept alongside Oversight rather than folded into it. The two answer different
 * questions — Oversight is "which of my twenty sites needs attention", Plans is "everything
 * for the one site I have selected" — and a manager is read-only on both, so neither offers
 * an action the server would refuse.
 *
 * @author Justin Chua
 */
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";

import {
  ConcernsStack,
  OversightStack,
  ProfileStack,
  RecommendationsStack,
  WeatherStack,
} from "./stacks";
import { tabScreenOptions } from "./tabOptions";
import { useTheme } from "@/theme/ThemeProvider";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loadConcerns, selectOpenConcernCount } from "@/store/reducers/wellbeingSlice";
import type { SafetyManagerTabParamList } from "./types";

const Tab = createBottomTabNavigator<SafetyManagerTabParamList>();

type TabIconProps = { color: string; size: number };
const OversightIcon = ({ color, size }: TabIconProps) => <Ionicons name="shield-checkmark" size={size} color={color} />;
const ConcernsIcon = ({ color, size }: TabIconProps) => <Ionicons name="medkit" size={size} color={color} />;
const RecommendationsIcon = ({ color, size }: TabIconProps) => <Ionicons name="clipboard" size={size} color={color} />;
const WeatherIcon = ({ color, size }: TabIconProps) => <Ionicons name="partly-sunny" size={size} color={color} />;
const ProfileIcon = ({ color, size }: TabIconProps) => <Ionicons name="person" size={size} color={color} />;

export default function SafetyManagerTabs() {
  const { t } = useTranslation();
  const theme = useTheme();

  const openConcerns = useAppSelector(selectOpenConcernCount);
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const siteId = useAppSelector((state) => state.shifts.selectedSiteId) ?? user?.siteIds[0] ?? null;

  /* Same reasoning as SupervisorTabs: a badge that only appears once you open the tab tells
     you nothing you did not already know by opening it. */
  useEffect(() => {
    if (!siteId) return;
    void dispatch(loadConcerns({ siteId }));
  }, [dispatch, siteId]);

  return (
    <Tab.Navigator screenOptions={tabScreenOptions(theme)}>
      {/* First, in the slot Shifts occupies for a supervisor: it is this role's home. */}
      <Tab.Screen
        name="OversightTab"
        component={OversightStack}
        options={{
          title: t("oversight.tabTitle"),
          // A shield rather than a clipboard or a list: this role assures rather than
          // executes, and the icon should not read as another queue of tasks.
          tabBarIcon: OversightIcon,
        }}
      />
      <Tab.Screen
        name="ConcernsTab"
        component={ConcernsStack}
        options={{
          title: t("wellbeing.concernsTab"),
          tabBarIcon: ConcernsIcon,
          tabBarBadge: openConcerns > 0 ? openConcerns : undefined,
          tabBarBadgeStyle: {
            backgroundColor: theme.colors.danger,
            color: theme.colors.textInverse,
          },
          tabBarAccessibilityLabel:
            openConcerns > 0
              ? `${t("wellbeing.concernsTab")}, ${t("wellbeing.concernOpen")}: ${openConcerns}`
              : t("wellbeing.concernsTab"),
        }}
      />
      <Tab.Screen
        name="RecommendationsTab"
        component={RecommendationsStack}
        options={{
          title: t("recommendations.tabTitle"),
          tabBarIcon: RecommendationsIcon,
        }}
      />
      <Tab.Screen
        name="WeatherTab"
        component={WeatherStack}
        options={{
          title: t("tabs.weather"),
          tabBarIcon: WeatherIcon,
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          title: t("tabs.profile"),
          tabBarIcon: ProfileIcon,
        }}
      />
    </Tab.Navigator>
  );
}
