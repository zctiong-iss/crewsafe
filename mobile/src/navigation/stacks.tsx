/**
 * One stack per tab.
 *
 * Header options live here rather than on each screen so that the header title, the tab
 * label and the accessibility name all come from the same translation key and cannot drift
 * apart when the language changes.
 */
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import ProfileScreen from "@/screens/profile/ProfileScreen";
import MyShiftScreen from "@/screens/worker/MyShiftScreen";
import InboxScreen from "@/screens/worker/InboxScreen";
import WeatherScreen from "@/screens/weather/WeatherScreen";
import ShiftListScreen from "@/screens/supervisor/ShiftListScreen";
import ShiftDetailScreen from "@/screens/supervisor/ShiftDetailScreen";
import CreateShiftScreen from "@/screens/supervisor/CreateShiftScreen";
import SettingsScreen from "@/screens/settings/SettingsScreen";
import { s } from "react-native-size-matters";
import { useTheme } from "@/theme/ThemeProvider";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { AppFonts } from "@/styles/fonts";
import type {
  InboxStackParamList,
  MyShiftStackParamList,
  ProfileStackParamList,
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
        options={{ title: t("tabs.inbox") }}
      />
    </InboxStackNavigator.Navigator>
  );
}

/* ------------------------------ Supervisor: Shifts ------------------------------ */

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
    </ProfileStackNavigator.Navigator>
  );
}
