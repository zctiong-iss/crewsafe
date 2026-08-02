/**
 * The language picker, as a bottom sheet.
 *
 * ── APPLIED IMMEDIATELY, NOT ON CONFIRM ─────────────────────────────────────────────────
 * The reference app puts a Confirm button under the list. That is the wrong shape for this
 * particular setting: the effect of choosing a language is visible instantly and everywhere,
 * so the choice confirms itself. A worker who does not read English well and has tapped into
 * this sheet by accident is better served by seeing the app change and tapping their own
 * language back than by having to find and interpret a Confirm button in a language they
 * cannot read.
 *
 * Each option is labelled in its own script for the same reason — someone looking for Hindi
 * should not have to read the word "Hindi" in English to find it.
 */
import { StyleSheet, View } from "react-native";
import ActionSheet, { SheetManager, type SheetProps } from "react-native-actions-sheet";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import RadioWithTitle from "../inputs/RadioWithTitle";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setLanguage } from "@/store/reducers/preferencesSlice";
import { languagesArr, type AppLanguage } from "@/localization/languagesList";
import { useTheme } from "@/theme/ThemeProvider";

export const LANGUAGE_SHEET_ID = "language-sheet";

export default function LanguageSheet(props: SheetProps<"language-sheet">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const current = useAppSelector((state) => state.preferences.language);

  const onSelect = (code: AppLanguage) => {
    // The store is the single source of truth; `LanguageSync` pushes it into i18next.
    // Nothing here talks to i18next directly, or the two could disagree after a rehydrate.
    dispatch(setLanguage(code));
    void SheetManager.hide(props.sheetId);
  };

  return (
    <ActionSheet
      id={props.sheetId}
      gestureEnabled
      containerStyle={{
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: theme.metrics.radius * 2,
        borderTopRightRadius: theme.metrics.radius * 2,
      }}
      indicatorStyle={{ backgroundColor: theme.colors.border }}
    >
      <View style={styles.container}>
        <AppText variant="subtitle" style={styles.title}>
          {t("settings.changeLanguage")}
        </AppText>

        {/* `.map`, not FlatList: three compile-time entries, and a VirtualizedList inside a
            sheet's own scroll container scrolls badly. */}
        {languagesArr.map((language) => (
          <RadioWithTitle
            key={language.code}
            title={language.label}
            selected={language.code === current}
            onPress={() => onSelect(language.code)}
          />
        ))}
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: s(16),
    paddingTop: vs(8),
    // Clears the home indicator on a gesture-navigation phone; a sheet sits below every
    // safe-area provider in the tree, so it cannot read insets the way a screen does.
    paddingBottom: vs(28),
  },
  title: {
    marginBottom: vs(12),
  },
});
