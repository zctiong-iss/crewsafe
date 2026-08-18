/**
 * What is actually going on with the reading on screen, when someone asks.
 *
 * ── WHY THE EXPLANATION MOVED BEHIND A TAP ──────────────────────────────────────────────
 * `FreshnessNotice` renders a standing banner below the weather card for every reading that
 * is not LIVE. On the screen a worker checks most often, that is a permanent block of
 * vertical space spent on a footnote — and after the tenth time it is read as furniture
 * rather than as information.
 *
 * ── AND WHY STALE DID NOT MOVE WITH IT ──────────────────────────────────────────────────
 * The four states are not equally serious and collapsing them all would have been a safety
 * regression rather than a tidy-up. §7.1's rule matrix requires stale data to "show warning",
 * and a warning only visible after tapping an icon nobody had reason to tap has not been
 * shown. So DELAYED and SIMULATED collapse into this modal; STALE keeps its banner AND gains
 * this, because it is the one where the reading must not be acted on at all.
 *
 * ── WHY IT COVERS MORE THAN FRESHNESS ───────────────────────────────────────────────────
 * "No reading yet" and "the request failed" were previously explained in two different places
 * and two different ways, and they are worth telling apart: one is the site's problem and one
 * is the phone's. A worker who cannot see a temperature needs to know which, because only one
 * of them is fixed by walking somewhere with signal.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { WeatherQualityStatus } from "@/types/domain";

/**
 * Everything this modal can explain.
 *
 * The freshness values plus the two non-reading cases. Widening `WeatherQualityStatus` itself
 * would be wrong — those two are not qualities of a reading, they are the absence of one.
 */
export type WeatherStatusSubject = WeatherQualityStatus | "NO_READING" | "LOAD_ERROR";

interface Presentation {
  icon: keyof typeof Ionicons.glyphMap;
  /** Which theme colour the icon takes. Never the only signal — the text says it too. */
  tone: "danger" | "warning" | "simulated" | "neutral";
  titleKey: string;
  bodyKey: string;
}

const PRESENTATION: Record<WeatherStatusSubject, Presentation> = {
  /*
   * Reuses the existing `freshness.*Warning` copy rather than restating it.
   *
   * Those strings were translated once into seven languages. A second set saying almost the
   * same thing would drift — and the version a worker saw would then depend on whether they
   * had tapped the icon or read the banner, which is not a distinction anyone intends.
   */
  STALE: {
    icon: "alert-circle",
    tone: "danger",
    titleKey: "freshness.STALE",
    bodyKey: "freshness.staleWarning",
  },
  DELAYED: {
    icon: "time",
    tone: "warning",
    titleKey: "freshness.DELAYED",
    bodyKey: "freshness.delayedWarning",
  },
  SIMULATED: {
    icon: "flask",
    // Its own tone, matching `FreshnessBadge`: simulated data is not degraded data, and
    // colouring it as a warning would make a demo look like a fault.
    tone: "simulated",
    titleKey: "freshness.SIMULATED",
    bodyKey: "freshness.simulatedNotice",
  },
  /*
   * Present so the map is total, and unreachable in practice — the info button is not
   * rendered for a live reading at all. An affordance that opens a dialog saying "everything
   * is fine" teaches people the button is not worth pressing, and then they do not press it
   * on the day it matters.
   */
  LIVE: {
    icon: "checkmark-circle",
    tone: "neutral",
    titleKey: "freshness.LIVE",
    bodyKey: "weather.statusLiveBody",
  },
  NO_READING: {
    icon: "help-circle",
    tone: "neutral",
    titleKey: "weather.noReadingTitle",
    bodyKey: "weather.noReadingBody",
  },
  LOAD_ERROR: {
    icon: "cloud-offline",
    tone: "warning",
    titleKey: "weather.statusErrorTitle",
    bodyKey: "weather.statusErrorBody",
  },
};

/** Degrades to a neutral explanation rather than throwing on a status this build predates. */
const UNKNOWN: Presentation = {
  icon: "help-circle",
  tone: "neutral",
  titleKey: "weather.statusUnknownTitle",
  bodyKey: "weather.statusUnknownBody",
};

interface WeatherStatusModalProps {
  visible: boolean;
  subject: WeatherStatusSubject;
  /**
   * When the reading was taken, already formatted, or null when there is no reading.
   *
   * "Delayed" without a timestamp leaves a worker unable to judge whether it is five minutes
   * old or fifty, which is the difference between usable and not. The word alone classifies
   * the reading; the time is what lets someone act on it.
   */
  observedAt: string | null;
  onDismiss: () => void;
}

const WeatherStatusModal: FC<WeatherStatusModalProps> = ({
  visible,
  subject,
  observedAt,
  onDismiss,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const { icon, tone, titleKey, bodyKey } = PRESENTATION[subject] ?? UNKNOWN;

  const iconColour =
    tone === "danger"
      ? theme.colors.danger
      : tone === "warning"
        ? theme.colors.warning
        : tone === "simulated"
          ? theme.colors.simulated
          : theme.colors.textSecondary;

  return (
    // `onRequestClose` is what makes the Android back gesture dismiss this. Without it the
    // modal is a trap on the platform where back is the primary way out of anything.
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={[styles.scrim, { backgroundColor: theme.colors.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: theme.metrics.borderWidth,
              borderRadius: theme.metrics.radius,
            },
          ]}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.heading}>
              <Ionicons name={icon} size={s(24)} color={iconColour} style={styles.icon} />
              {/* flex so a long translated title wraps inside the card rather than past it. */}
              <AppText variant="subtitle" style={styles.title}>
                {t(titleKey)}
              </AppText>
            </View>

            <AppText variant="body">{t(bodyKey)}</AppText>

            {observedAt ? (
              <AppText variant="caption" tone="secondary" style={styles.observed}>
                {t("weather.statusObservedAt", { time: observedAt })}
              </AppText>
            ) : null}

            <AppButton title={t("common.close")} variant="secondary" style={styles.action} onPress={onDismiss} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default WeatherStatusModal;

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: sharedPaddingHorizontal,
  },
  sheet: {
    maxHeight: "80%",
  },
  content: {
    padding: s(20),
    gap: vs(10),
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    marginRight: s(8),
  },
  title: {
    flex: 1,
  },
  observed: {
    marginTop: vs(2),
  },
  action: {
    marginTop: vs(8),
  },
});
