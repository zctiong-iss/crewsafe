/**
 * The three accessibility settings, plus language.
 *
 * ── THESE ARE SAFETY CONTROLS, NOT PREFERENCES ──────────────────────────────────────────
 * Every one of them exists because of the operating condition: a phone held at arm's length
 * in Singapore sun, by someone who may not read English, possibly in gloves.
 *
 *   Language        FR-26c's neighbour. A worker who cannot read the instruction cannot
 *                   follow it, and a stop-work notice they cannot read is not a warning.
 *   Text size       Applied on top of device scaling by `AppText`, capped at 1.5 because
 *                   past that the fixed-height controls clip their own labels.
 *   High contrast   Collapses greys to black and doubles border widths. Glare removes
 *                   low-contrast detail first.
 *   Reduce motion   WCAG 2.2 SC 2.2.2 — looping animation must be stoppable.
 *
 * All four are persisted (see `persistConfig`): a worker who set the app up for sunlight
 * must not have to do it again every morning.
 *
 * @author Justin Chua
 */
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppSwitch from "@/components/inputs/AppSwitch";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  setFontScale,
  setHighContrast,
  setNotificationsMuted,
  setReduceMotion,
} from "@/store/reducers/preferencesSlice";
import AppButton from "@/components/buttons/AppButton";
import { getPermission, type NotificationPermission } from "@/notifications/notificationClient";
import { useNotificationPermission } from "@/notifications/useNotificationPermission";
import LanguageSheet from "@/components/sheets/LanguageSheet";
import { languagesArr } from "@/localization/languagesList";
import { FONT_SCALE_STEPS } from "@/styles/theme";
import { useReduceMotion, useReduceMotionPreference } from "@/hooks/useReduceMotion";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

/** `FONT_SCALE_STEPS` keys → translation keys, so the labels stay translatable. */
const SCALE_LABELS: Record<string, string> = {
  small: "settings.textSizeSmall",
  default: "settings.textSizeDefault",
  large: "settings.textSizeLarge",
  extraLarge: "settings.textSizeExtraLarge",
};

export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const language = useAppSelector((state) => state.preferences.language);
  const fontScale = useAppSelector((state) => state.preferences.fontScale);
  const highContrast = useAppSelector((state) => state.preferences.highContrast);
  // Per user, unlike the three above. See `preferencesSlice` for where that line is drawn.
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const reduceMotionPreference = useReduceMotionPreference();

  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);

  /*
   * ── THE SWITCH SHOWS THE OS's ANSWER, NOT A COPY OF IT ────────────────────────────────
   * The operating system owns whether this app may notify, and that can be revoked outside
   * the app at any time. A switch driven purely by the stored `notificationsMuted` flag would
   * happily read "on" for notifications the OS has been silently dropping since the user
   * turned them off in system settings a week ago.
   *
   * So the permission is read from the OS, and re-read on every focus — returning from the
   * system settings screen is precisely the case where it will have changed, and it is the
   * one moment nothing else would prompt a refresh.
   */
  const notificationsMuted = useAppSelector((state) => state.preferences.notificationsMuted);
  const { ensure: ensureNotifications, openSystemSettings } = useNotificationPermission();
  const [permission, setPermission] = useState<NotificationPermission>("undetermined");

  const refreshPermission = useCallback(() => {
    void getPermission().then(setPermission);
  }, []);
  useFocusEffect(refreshPermission);
  useEffect(refreshPermission, [refreshPermission]);

  const notificationsBlocked = permission === "denied";
  const notificationsOn = permission === "granted" && !notificationsMuted;


  // The effective value, which may be true because the *device* says so.
  const reduceMotionEffective = useReduceMotion();
  const forcedByDevice = reduceMotionEffective && !reduceMotionPreference;

  const currentLanguageLabel =
    languagesArr.find((entry) => entry.code === language)?.label ?? language;

  const card = [
    styles.card,
    cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
    { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
  ];

  return (
    <AppSafeView>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ───────────────────────── Language ───────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("settings.language")}
        </AppText>

        <View style={card}>
          <RadioWithTitle
            // Reuses the radio row for its layout and tap target, but it opens a sheet
            // rather than selecting — so it is never shown as selected.
            title={t("settings.changeLanguage")}
            subtitle={currentLanguageLabel}
            selected={false}
            onPress={() => setLanguageSheetOpen(true)}
          />
        </View>

        <LanguageSheet
          visible={languageSheetOpen}
          onClose={() => setLanguageSheetOpen(false)}
        />

        {/* ───────────────────────── Display ────────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("settings.display")}
        </AppText>

        <View style={card}>
          <AppText variant="label" style={styles.fieldLabel}>
            {t("settings.textSize")}
          </AppText>

          <View accessibilityRole="radiogroup" accessibilityLabel={t("settings.textSize")}>
            {FONT_SCALE_STEPS.map((step) => (
              <RadioWithTitle
                key={step.key}
                title={t(SCALE_LABELS[step.key])}
                // Compared with a tolerance rather than `===`: the stored value has been
                // through `clampFontScale` and JSON, and an exact float match on a
                // persisted number is a needless way to lose the selected state.
                selected={Math.abs(fontScale - step.value) < 0.001}
                onPress={() => dispatch(setFontScale(step.value))}
              />
            ))}
          </View>

          {/* The preview is the point of the setting — a number like "1.2" means nothing,
              a sentence at that size means everything. It scales with the live value. */}
          <View
            style={[
              styles.preview,
              {
                borderColor: theme.colors.border,
                borderWidth: theme.metrics.borderWidth,
                borderRadius: theme.metrics.radius / 2,
              },
            ]}
          >
            <AppText variant="body">{t("settings.textSizePreview")}</AppText>
          </View>
        </View>

        {/* ─────────────────────── Accessibility ────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("settings.accessibility")}
        </AppText>

        <View style={card}>
          <AppSwitch
            label={t("settings.highContrast")}
            hint={t("settings.highContrastHint")}
            value={highContrast}
            onValueChange={(value) => dispatch(setHighContrast(value))}
          />

          <View
            style={[styles.divider, { backgroundColor: theme.colors.border }]}
            accessibilityElementsHidden
          />

          {/*
            Shown as on and locked when the device forces it.
            Leaving the toggle off while animations are stopped would look like the setting
            is broken; letting someone switch it off here would imply the app can override
            a system accessibility setting, which it cannot and should not.
          */}
          <AppSwitch
            label={t("settings.reduceMotion")}
            hint={t("settings.reduceMotionHint")}
            value={reduceMotionEffective}
            // Also disabled with nobody signed in: there would be no account to write the
            // choice against, and silently discarding a toggle is worse than not offering
            // it. Unreachable today — Settings only mounts inside a signed-in tab tree —
            // but it is one navigation change away from being reachable.
            disabled={forcedByDevice || userId === null}
            onValueChange={(value) => {
              if (!userId) return;
              dispatch(setReduceMotion({ userId, reduceMotion: value }));
            }}
          />
        </View>

        {/* ────────────────────── Notifications ─────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("settings.notifications")}
        </AppText>

        <View style={card}>
          <AppSwitch
            label={t("settings.notificationsLabel")}
            hint={
              // Three different truths, and conflating them would leave someone toggling a
              // switch that cannot do anything. Blocked is the one that needs a way out.
              notificationsBlocked
                ? t("settings.notificationsBlockedHint")
                : t("settings.notificationsHint")
            }
            value={notificationsOn}
            // Locked when the OS has refused. Leaving it operable would imply the app can
            // overrule a system permission, which it cannot — and a switch that flips back
            // on its own reads as a bug rather than as a permission problem.
            disabled={notificationsBlocked}
            onValueChange={(value) => {
              if (!value) {
                dispatch(setNotificationsMuted(true));
                return;
              }
              /*
               * Unmute first, then ask.
               *
               * `ensure` refuses outright while muted — that is what mute means — so asking
               * before clearing the flag would show nothing and silently leave the switch off.
               */
              dispatch(setNotificationsMuted(false));
              void ensureNotifications().then(refreshPermission);
            }}
          />

          {notificationsBlocked ? (
            <>
              <View
                style={[styles.divider, { backgroundColor: theme.colors.border }]}
                accessibilityElementsHidden
              />
              {/* The only route back. iOS shows its permission prompt once per install, so
                  an app that has been refused cannot ask again from in here — it can only
                  send the user to the place where the answer can be changed. */}
              <AppButton
                title={t("settings.notificationsOpenSettings")}
                variant="secondary"
                onPress={openSystemSettings}
              />
            </>
          ) : null}
        </View>

        {/* ────────────────────────── About ─────────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("settings.about")}
        </AppText>

        <View style={card}>
          <View style={styles.aboutRow}>
            <Ionicons
              name="shield-checkmark"
              size={s(22)}
              color={theme.colors.textPrimary}
              style={styles.aboutIcon}
            />
            {/* flex:1 so the description wraps inside the card rather than past its edge. */}
            <View style={styles.aboutBody}>
              <AppText variant="body">{t("common.appName")}</AppText>
              <AppText variant="caption" tone="secondary" style={styles.aboutLine}>
                {t("settings.aboutBody")}
              </AppText>
              <AppText variant="caption" tone="secondary" style={styles.aboutLine}>
                {t("settings.aboutVersion", {
                  version: Constants.expoConfig?.version ?? "—",
                })}
              </AppText>
            </View>
          </View>
        </View>
      </ScrollView>
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(12),
  },
  sectionTitle: {
    marginTop: vs(12),
    marginBottom: vs(8),
  },
  card: {
    padding: s(14),
  },
  fieldLabel: {
    marginBottom: vs(4),
  },
  preview: {
    marginTop: vs(12),
    padding: s(12),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: vs(6),
  },
  aboutRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  aboutIcon: {
    marginEnd: s(12),
    marginTop: vs(2),
  },
  aboutBody: {
    flex: 1,
  },
  aboutLine: {
    marginTop: vs(4),
  },
});
