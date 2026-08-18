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
 *
 * @author Justin Chua
 */
import { useCallback, useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";

import NotificationRouter from "@/notifications/NotificationRouter";
import { configureNotifications } from "@/notifications/notificationClient";
import { StatusBar } from "expo-status-bar";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import { I18nextProvider } from "react-i18next";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";

/*
 * Imported per WEIGHT, not from the package root.
 *
 * Each @expo-google-fonts package re-exports all NINE weights from its index, and every
 * one of those requires its own .ttf — so a root import bundles all nine whether or not
 * they are used. The app uses four. Measured on an Android export: 6.3 MB of fonts, of
 * which 3.5 MB were weights nothing references. Subpath imports pull exactly the four.
 */
import { Lexend_400Regular } from "@expo-google-fonts/lexend/400Regular";
import { Lexend_500Medium } from "@expo-google-fonts/lexend/500Medium";
import { Lexend_600SemiBold } from "@expo-google-fonts/lexend/600SemiBold";
import { Lexend_700Bold } from "@expo-google-fonts/lexend/700Bold";
import { NotoSansTamil_400Regular } from "@expo-google-fonts/noto-sans-tamil/400Regular";
import { NotoSansTamil_500Medium } from "@expo-google-fonts/noto-sans-tamil/500Medium";
import { NotoSansTamil_600SemiBold } from "@expo-google-fonts/noto-sans-tamil/600SemiBold";
import { NotoSansTamil_700Bold } from "@expo-google-fonts/noto-sans-tamil/700Bold";
import { NotoSansBengali_400Regular } from "@expo-google-fonts/noto-sans-bengali/400Regular";
import { NotoSansBengali_500Medium } from "@expo-google-fonts/noto-sans-bengali/500Medium";
import { NotoSansBengali_600SemiBold } from "@expo-google-fonts/noto-sans-bengali/600SemiBold";
import { NotoSansBengali_700Bold } from "@expo-google-fonts/noto-sans-bengali/700Bold";
import { NotoSansMyanmar_400Regular } from "@expo-google-fonts/noto-sans-myanmar/400Regular";
import { NotoSansMyanmar_500Medium } from "@expo-google-fonts/noto-sans-myanmar/500Medium";
import { NotoSansMyanmar_600SemiBold } from "@expo-google-fonts/noto-sans-myanmar/600SemiBold";
import { NotoSansMyanmar_700Bold } from "@expo-google-fonts/noto-sans-myanmar/700Bold";
import { NotoSansDevanagari_400Regular } from "@expo-google-fonts/noto-sans-devanagari/400Regular";
import { NotoSansDevanagari_500Medium } from "@expo-google-fonts/noto-sans-devanagari/500Medium";
import { NotoSansDevanagari_600SemiBold } from "@expo-google-fonts/noto-sans-devanagari/600SemiBold";
import { NotoSansDevanagari_700Bold } from "@expo-google-fonts/noto-sans-devanagari/700Bold";

import { persistor, store } from "@/store/store";
import i18n from "@/localization/i18n";
import LanguageSync from "@/localization/LanguageSync";
import { ThemeProvider } from "@/theme/ThemeProvider";
import RootNavigator from "@/navigation/RootNavigator";
import Toast from "@/components/feedback/Toast";
import { installSessionBridge } from "@/auth/sessionBridge";

// Called in global scope, not in a hook: by the time an effect runs the splash may already
// have auto-hidden, and the app would flash its background before the fonts arrive.
void SplashScreen.preventAutoHideAsync();

installSessionBridge();

export default function App() {
  /*
   * Every script's family, loaded up front rather than on demand (SCRUM-205).
   *
   * The same reasoning that keeps translations in the bundle applies to the faces that draw
   * them: a worker who loses signal mid-shift must not lose their language. Loading a font
   * at the moment someone switches language would need a loading state, and would fail
   * outright on a site phone with no connection — which is the operating condition, not an
   * edge case. The cost is a larger bundle and a slightly slower cold start, paid once.
   *
   * Lexend covers Latin only — it publishes just the latin, latin-ext and vietnamese subsets.
   * Tamil, Bengali, Myanmar and Devanagari have no glyphs in it at all, so each gets its Noto
   * family. Simplified Chinese deliberately gets none and falls through to the system's CJK
   * face; see `styles/fonts.ts` for that decision and for how a family is chosen per language.
   */
  const [fontsLoaded, fontError] = useFonts({
    Lexend_400Regular,
    Lexend_500Medium,
    Lexend_600SemiBold,
    Lexend_700Bold,

    NotoSansTamil_400Regular,
    NotoSansTamil_500Medium,
    NotoSansTamil_600SemiBold,
    NotoSansTamil_700Bold,

    NotoSansBengali_400Regular,
    NotoSansBengali_500Medium,
    NotoSansBengali_600SemiBold,
    NotoSansBengali_700Bold,

    NotoSansMyanmar_400Regular,
    NotoSansMyanmar_500Medium,
    NotoSansMyanmar_600SemiBold,
    NotoSansMyanmar_700Bold,

    NotoSansDevanagari_400Regular,
    NotoSansDevanagari_500Medium,
    NotoSansDevanagari_600SemiBold,
    NotoSansDevanagari_700Bold,
  });

  // A font that fails to load must not hold the splash forever — the app is still usable
  // in the system face, and a permanently frozen splash looks like a crash.
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (fontError) {
      // Worth more than a shrug now that five families load here: in Latin the fallback is
      // merely a different sans, but for Tamil, Bengali, Myanmar or Devanagari it is the
      // difference between readable text and tofu.
      console.warn("A font failed to load; falling back to the system face.", fontError);
    }
  }, [fontError]);

  /*
   * Notification setup, before anything can be sent.
   *
   * Ordering matters on both platforms and for opposite reasons. Android ignores a channel's
   * importance and vibration pattern once the channel exists, so it has to be created before
   * the first notification rather than lazily beside it. iOS shows nothing for a notification
   * arriving in the foreground unless a handler is registered, and the rest timer fires at a
   * moment the worker may well be looking at the screen.
   *
   * Deliberately not awaited and deliberately unable to reject: a notification channel is not
   * worth holding the splash screen for, and certainly not worth failing to start over.
   */
  useEffect(() => {
    void configureNotifications();
  }, []);

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
                {/* Sheets are rendered by the screens that own them, as ordinary
                    components with a `visible` prop — there is no provider to install.
                    See `components/sheets/BottomSheet.tsx`. */}
                <NavigationContainer>
                  {/* Inside the container so it can reach the navigator, outside every
                      screen so a tapped notification is routed whatever is on top. */}
                  <NotificationRouter />
                  <RootNavigator />
                </NavigationContainer>
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
