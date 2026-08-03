/**
 * The app's one loading indicator.
 *
 * The animation itself lives in `LottieSpinner`, which has a platform-specific web
 * variant — see the comment there for why that split is necessary rather than tidy.
 *
 * The bundled `loading.json` is a plain rotating arc, authored in-repo so the app has no
 * network or licensing dependency to run. To use a richer animation from lottiefiles.com,
 * drop the .json into `src/assets/animations/` and change the `require` in
 * `LottieSpinner.tsx` — nothing else needs to know.
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { s, vs } from "react-native-size-matters";
import LottieSpinner from "./LottieSpinner";
import AppText from "../texts/AppText";
import { useTheme } from "@/theme/ThemeProvider";

interface AppLoaderProps {
  /** Optional caption. Already-translated text — pass `t("...")`, never a raw key. */
  message?: string;
  size?: number;
  /** Fills its parent and centres itself. Use for whole-screen loads. */
  fullscreen?: boolean;
}

const AppLoader: FC<AppLoaderProps> = ({ message, size = 96, fullscreen = false }) => {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.container,
        fullscreen ? { flex: 1, backgroundColor: theme.colors.background } : null,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
    >
      <LottieSpinner size={s(size)} color={theme.colors.primary} />

      {message ? (
        <AppText variant="label" tone="secondary" style={styles.message}>
          {message}
        </AppText>
      ) : null}
    </View>
  );
};

export default AppLoader;

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    marginTop: vs(10),
    textAlign: "center",
    // The container centres its children but sets no width, so it sizes to its widest
    // child. Without a cap, a long caption stretches the whole loader past its parent
    // instead of wrapping — visible wherever the loader is used inline rather than
    // fullscreen, since fullscreen is bounded by the screen anyway.
    maxWidth: s(260),
  },
});
