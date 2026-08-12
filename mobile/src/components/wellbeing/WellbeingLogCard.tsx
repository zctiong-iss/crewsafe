/**
 * The two buttons a worker actually presses, and the way out to raising a concern (US-11).
 *
 * ── WHY ONE TAP AND NOTHING ELSE ────────────────────────────────────────────────────────
 * This is used in gloves, in direct sun, in the middle of doing something else. Anything that
 * asks a follow-up question — how long did you rest, how much did you drink — is a control that
 * gets used once and then ignored, and a log nobody makes tells a supervisor nothing. The
 * question they are actually asking is "has anyone not rested in two hours", which a timestamp
 * answers on its own.
 *
 * ── THE FEEDBACK IS THE POINT ───────────────────────────────────────────────────────────
 * A button that does nothing visible gets pressed again. Each shows when it was last used, from
 * the server's own timestamp rather than the device clock — a phone with a wrong clock must not
 * tell its owner they rested at a time their supervisor will never see.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import MessageBanner from "@/components/feedback/MessageBanner";
import { formatTime } from "@/helpers/dateTime";
import { cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { WellbeingLogType } from "@/types/domain";

interface WellbeingLogCardProps {
  /** Server timestamps for what has been logged this session, keyed by kind. */
  justLogged: Partial<Record<WellbeingLogType, string>>;
  loggingType: WellbeingLogType | null;
  errorKey: string | null;
  onLog: (logType: WellbeingLogType) => void;
  onRaiseConcern: () => void;
}

const WellbeingLogCard: FC<WellbeingLogCardProps> = ({
  justLogged,
  loggingType,
  errorKey,
  onLog,
  onRaiseConcern,
}) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const subtitleFor = (logType: WellbeingLogType) => {
    const at = justLogged[logType];
    return at
      ? t("wellbeing.loggedAt", { time: formatTime(at, i18n.language) })
      : t("wellbeing.notLoggedYet");
  };

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
      ]}
    >
      <AppText variant="subtitle">{t("wellbeing.sectionTitle")}</AppText>

      {/* Reported inline rather than as an Alert: a failed log is worth retrying on the spot,
          and a dialog would take the button out from under the thumb that just pressed it. */}
      {errorKey ? (
        <View style={styles.block}>
          <MessageBanner message={t("wellbeing.logFailed")} tone="danger" />
        </View>
      ) : null}

      <View style={styles.action}>
        <AppButton
          title={loggingType === "REST" ? t("wellbeing.logging") : t("wellbeing.logRest")}
          loading={loggingType === "REST"}
          onPress={() => onLog("REST")}
        />
        <AppText variant="caption" tone="secondary" style={styles.subtitle}>
          {subtitleFor("REST")}
        </AppText>
      </View>

      <View style={styles.action}>
        <AppButton
          title={loggingType === "HYDRATION" ? t("wellbeing.logging") : t("wellbeing.logHydration")}
          loading={loggingType === "HYDRATION"}
          onPress={() => onLog("HYDRATION")}
        />
        <AppText variant="caption" tone="secondary" style={styles.subtitle}>
          {subtitleFor("HYDRATION")}
        </AppText>
      </View>

      {/* Danger-toned and last. It is not a logging button — pressing it starts a conversation
          with a supervisor, and it should not be reachable by a thumb aiming for "I rested". */}
      <AppButton
        title={t("wellbeing.raiseConcern")}
        variant="danger"
        onPress={onRaiseConcern}
        style={styles.concern}
      />
    </View>
  );
};

export default WellbeingLogCard;

const styles = StyleSheet.create({
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  block: {
    marginTop: vs(10),
  },
  action: {
    marginTop: vs(12),
  },
  subtitle: {
    marginTop: vs(4),
  },
  concern: {
    marginTop: vs(18),
  },
});
