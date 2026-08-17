/**
 * One stack per tab.
 *
 * Header options live here rather than on each screen so that the header title, the tab
 * label and the accessibility name all come from the same translation key and cannot drift
 * apart when the language changes.
 *
 * @author Justin Chua
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import ProfileScreen from "@/screens/profile/ProfileScreen";
import MyShiftScreen from "@/screens/worker/MyShiftScreen";
import InboxScreen from "@/screens/worker/InboxScreen";
import WeatherScreen from "@/screens/weather/WeatherScreen";
import ForecastScreen from "@/screens/weather/ForecastScreen";
import OversightScreen from "@/screens/safety/OversightScreen";
import ShiftListScreen from "@/screens/supervisor/ShiftListScreen";
import ShiftDetailScreen from "@/screens/supervisor/ShiftDetailScreen";
import CreateShiftScreen from "@/screens/supervisor/CreateShiftScreen";
import ConcernsScreen from "@/screens/supervisor/ConcernsScreen";
import RecommendationsScreen from "@/screens/supervisor/RecommendationsScreen";
import RecommendationDetailScreen from "@/screens/supervisor/RecommendationDetailScreen";
import SettingsScreen from "@/screens/settings/SettingsScreen";
import PolicyVersionsScreen from "@/screens/policy/PolicyVersionsScreen";
import PolicyVersionDetailScreen from "@/screens/policy/PolicyVersionDetailScreen";
import NewPolicyVersionScreen from "@/screens/policy/NewPolicyVersionScreen";
import { s } from "react-native-size-matters";
import { useTheme } from "@/theme/ThemeProvider";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { AppFonts } from "@/styles/fonts";
import type {
  ConcernsStackParamList,
  InboxStackParamList,
  MyShiftStackParamList,
  ProfileStackParamList,
  OversightStackParamList,
  RecommendationsStackParamList,
  ShiftsStackParamList,
  WeatherStackParamList,
} from "./types";

/**
 * Shared header styling, so every setting reaches the navigation chrome and not just the
 * screen content.
 *
 * Two things here are easy to leave out and were:
 *
 *   fontSize   A header title is a `Text` React Navigation renders itself, so it never
 *              passes through `AppText` and does not inherit the text-size setting. Without
 *              this the screen title stays fixed while everything under it grows, which
 *              looks like the setting only half worked.
 *
 *   animation  Screen transitions are the most motion in the app by a distance. Reduce
 *              motion that silences a pulsing icon but still slides a whole screen sideways
 *              has missed the thing that actually troubles a vestibular disorder.
 */
export function useScreenOptions() {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();

  return {
    headerStyle: { backgroundColor: theme.colors.surface },
    headerTintColor: theme.colors.textPrimary,
    headerTitleStyle: {
      fontFamily: AppFonts.semiBold,
      color: theme.colors.textPrimary,
      // Capped below the app's 1.5 maximum: a native-stack header has a fixed height, so
      // past roughly this the title clips rather than growing the bar.
      fontSize: s(17) * Math.min(theme.fontScale, 1.3),
    },
    headerShadowVisible: !theme.highContrast,
    contentStyle: { backgroundColor: theme.colors.background },
    animation: reduceMotion ? ("none" as const) : ("default" as const),
  } as const;
}

/* ------------------------------- Worker: My shift ------------------------------- */

const MyShiftStackNavigator = createNativeStackNavigator<MyShiftStackParamList>();

export function MyShiftStack() {
  const { t } = useTranslation();

  return (
    <MyShiftStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <MyShiftStackNavigator.Screen
        name="MyShift"
        component={MyShiftScreen}
        options={{ title: t("tabs.shift") }}
      />
    </MyShiftStackNavigator.Navigator>
  );
}

/* --------------------------------- Worker: Inbox -------------------------------- */

const InboxStackNavigator = createNativeStackNavigator<InboxStackParamList>();

export function InboxStack() {
  const { t } = useTranslation();

  return (
    <InboxStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <InboxStackNavigator.Screen
        name="Inbox"
        component={InboxScreen}
        options={{ title: t("tabs.alerts") }}
      />
    </InboxStackNavigator.Navigator>
  );
}

/* ------------------------------ Supervisor: Shifts ------------------------------ */

const OversightStackNavigator = createNativeStackNavigator<OversightStackParamList>();

/**
 * The safety manager's site-and-plans view (SCRUM-TBD-90).
 *
 * A single screen with no detail route, deliberately: a manager reads plans, and the decision
 * screen behind `RecommendationDetail` exists to approve, edit or reject — all three of which
 * `RecommendationDetailScreen` already refuses this role with a read-only notice. Routing them
 * there would offer a journey that ends in "you cannot do this".
 */
export function OversightStack() {
  const { t } = useTranslation();

  return (
    <OversightStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <OversightStackNavigator.Screen
        name="Oversight"
        component={OversightScreen}
        options={{ title: t("oversight.title") }}
      />
    </OversightStackNavigator.Navigator>
  );
}

const ShiftsStackNavigator = createNativeStackNavigator<ShiftsStackParamList>();

export function ShiftsStack() {
  const { t } = useTranslation();

  return (
    <ShiftsStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <ShiftsStackNavigator.Screen
        name="ShiftList"
        component={ShiftListScreen}
        options={{ title: t("tabs.shifts") }}
      />
      <ShiftsStackNavigator.Screen
        name="ShiftDetail"
        component={ShiftDetailScreen}
        options={{ title: t("shifts.detailTitle") }}
      />
      <ShiftsStackNavigator.Screen
        name="CreateShift"
        component={CreateShiftScreen}
        options={{ title: t("shifts.createButton") }}
      />
    </ShiftsStackNavigator.Navigator>
  );
}

/* ------------------------------ Supervisor: Concerns ---------------------------- */

const ConcernsStackNavigator = createNativeStackNavigator<ConcernsStackParamList>();

export function ConcernsStack() {
  const { t } = useTranslation();

  return (
    <ConcernsStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <ConcernsStackNavigator.Screen
        name="Concerns"
        component={ConcernsScreen}
        options={{ title: t("wellbeing.concernsTitle") }}
      />
    </ConcernsStackNavigator.Navigator>
  );
}

/* ------------------------------ Recommendations --------------------------------- */

const RecommendationsStackNavigator = createNativeStackNavigator<RecommendationsStackParamList>();

export function RecommendationsStack() {
  const { t } = useTranslation();

  return (
    <RecommendationsStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <RecommendationsStackNavigator.Screen
        name="RecommendationList"
        component={RecommendationsScreen}
        options={{ title: t("recommendations.title") }}
      />
      <RecommendationsStackNavigator.Screen
        name="RecommendationDetail"
        component={RecommendationDetailScreen}
        options={{ title: t("recommendations.title") }}
      />
    </RecommendationsStackNavigator.Navigator>
  );
}

/* ---------------------------------- Weather ------------------------------------ */

const WeatherStackNavigator = createNativeStackNavigator<WeatherStackParamList>();

export function WeatherStack() {
  const { t } = useTranslation();

  return (
    <WeatherStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <WeatherStackNavigator.Screen
        name="Weather"
        component={WeatherScreen}
        options={{ title: t("tabs.weather") }}
      />
      <WeatherStackNavigator.Screen
        name="Forecast"
        component={ForecastScreen}
        options={{ title: t("forecast.title") }}
      />
    </WeatherStackNavigator.Navigator>
  );
}

/* ---------------------------------- Profile ------------------------------------ */

const ProfileStackNavigator = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack() {
  const { t } = useTranslation();

  return (
    <ProfileStackNavigator.Navigator screenOptions={useScreenOptions()}>
      <ProfileStackNavigator.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: t("tabs.profile") }}
      />
      <ProfileStackNavigator.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t("tabs.settings") }}
      />
      <ProfileStackNavigator.Screen
        name="PolicyVersions"
        component={PolicyVersionsScreen}
        options={{ title: t("policy.title") }}
      />
      <ProfileStackNavigator.Screen
        name="PolicyVersionDetail"
        component={PolicyVersionDetailScreen}
        options={{ title: t("policy.title") }}
      />
      <ProfileStackNavigator.Screen
        name="NewPolicyVersion"
        component={NewPolicyVersionScreen}
        options={{ title: t("policy.newVersionTitle") }}
      />
    </ProfileStackNavigator.Navigator>
  );
}
