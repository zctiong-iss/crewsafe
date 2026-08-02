/**
 * Provider tree and startup gate.
 *
 * Order matters and is not arbitrary:
 *
 *   GestureHandlerRootView  must be the outermost native view, or gesture-driven
 *                           components (the action sheets used for language and photo
 *                           choice) receive no touches on Android.
 *   Provider                everything below reads the store.
 *   PersistGate             holds rendering until AsyncStorage has rehydrated, so the app
 *                           never paints in English at default size and then snaps to the
 *                           user's real settings a frame later.
 *   ThemeProvider           needs the rehydrated preferences to build the theme.
 *   I18nextProvider         LanguageSync, inside it, pushes the store's language into i18n.
 *   SafeAreaProvider        supplies the insets AppSafeView reads.
 *   NavigationContainer     innermost, so every screen it renders has all of the above.
 */
import "react-native-gesture-handler";

import { useCallback, useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { I18nextProvider } from "react-i18next";
import { SheetProvider } from "react-native-actions-sheet";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  Gelasio_400Regular,
  Gelasio_500Medium,
  Gelasio_600SemiBold,
  Gelasio_700Bold,
} from "@expo-google-fonts/gelasio";

import { persistor, store } from "@/store/store";
import i18n from "@/localization/i18n";
import LanguageSync from "@/localization/LanguageSync";
import { ThemeProvider } from "@/theme/ThemeProvider";
import RootNavigator from "@/navigation/RootNavigator";
import Toast from "@/components/feedback/Toast";
// Side-effect import: registers every sheet by id. Without it `SheetManager.show(...)`
// resolves to nothing and the sheet silently never appears.
import "@/components/sheets";
import { installSessionBridge } from "@/auth/sessionBridge";

// Called in global scope, not in a hook: by the time an effect runs the splash may already
// have auto-hidden, and the app would flash its background before the fonts arrive.
void SplashScreen.preventAutoHideAsync();

installSessionBridge();

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Gelasio_400Regular,
    Gelasio_500Medium,
    Gelasio_600SemiBold,
    Gelasio_700Bold,
  });

  // A font that fails to load must not hold the splash forever — the app is still usable
  // in the system face, and a permanently frozen splash looks like a crash.
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (fontError) {
      console.warn("Gelasio failed to load; falling back to the system font.", fontError);
    }
  }, [fontError]);

  const onLayoutRootView = useCallback(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayoutRootView}>
      <Provider store={store}>
        {/* No loading prop: the native splash is still up until onLayout fires, so a
            second loading view here would only ever flash. */}
        <PersistGate persistor={persistor}>
          <ThemeProvider>
            <I18nextProvider i18n={i18n}>
              <LanguageSync />
              <SafeAreaProvider>
                <StatusBar style="dark" />
                {/* Inside the store and i18n providers, because a sheet's content reads
                    both — the language picker is itself translated. */}
                <SheetProvider>
                  <NavigationContainer>
                    <RootNavigator />
                  </NavigationContainer>
                </SheetProvider>
                {/* Outside the navigator on purpose: a toast is usually triggered by an
                    action that navigates away, and one owned by a screen would unmount
                    before it could be read. */}
                <Toast />
              </SafeAreaProvider>
            </I18nextProvider>
          </ThemeProvider>
        </PersistGate>
      </Provider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
