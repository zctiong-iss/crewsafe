import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { InboxStack, MyShiftStack, ProfileStack, WeatherStack } from "./stacks";
import { tabScreenOptions } from "./tabOptions";
import { useTheme } from "@/theme/ThemeProvider";
import type { WorkerTabParamList } from "./types";

const Tab = createBottomTabNavigator<WorkerTabParamList>();

/**
 * What a WORKER sees. Their own shift, the actions dispatched to them, the weather, and
 * their settings — nothing that would 403.
 */
export default function WorkerTabs() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Tab.Navigator screenOptions={tabScreenOptions(theme)}>
      <Tab.Screen
        name="MyShiftTab"
        component={MyShiftStack}
        options={{
          title: t("tabs.shift"),
          tabBarIcon: ({ color, size }) => <Ionicons name="today" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="InboxTab"
        component={InboxStack}
        options={{
          title: t("tabs.inbox"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications" size={size} color={color} />
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
