import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import SignInScreen from "@/screens/auth/SignInScreen";
import SignUpScreen from "@/screens/auth/SignUpScreen";
import { useScreenOptions } from "./stacks";
import type { AuthStackParamList } from "./types";

const Stack = createNativeStackNavigator<AuthStackParamList>();

/**
 * Sign in and request-an-account.
 *
 * Sign-up is a request form rather than a registration: the Cognito pool is created with
 * `allow_admin_create_user_only = true`, so self-service registration is switched off at
 * the identity provider, and no backend endpoint exists to provision an application user.
 */
export default function AuthStack() {
  const { t } = useTranslation();

  return (
    <Stack.Navigator screenOptions={useScreenOptions()}>
      <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="SignUp"
        component={SignUpScreen}
        options={{ title: t("signUp.title") }}
      />
    </Stack.Navigator>
  );
}
