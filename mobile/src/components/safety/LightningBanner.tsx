/**
 * The lightning stop-work banner (SCRUM-172, FR-12a).
 *
 * Four rendered states from two inputs — the risk state and whether the validity window has
 * lapsed:
 *
 *   STOP_WORK, active    loudest thing on the screen. Filled, not outlined.
 *   ADVISORY,  active    warning tone. "be ready to stop", not "stop".
 *   CLEAR,     active    quiet confirmation that the site was assessed, not silence.
 *   any,       expired   muted, and explicitly *not* an all-clear.
 *
 * ── WHY EXPIRY IS NOT AN ALL-CLEAR ──────────────────────────────────────────────────────
 * SCRUM-172 says the warning "clears on expiry", and §7.1 says a stop-work holds "until a
 * supervisor-confirmed all-clear, typically 30 minutes after the last nearby strike". Those
 * are not the same event. What lapses at `validUntil` is the *server's assessment*, not the
 * hazard, and the supervisor is the one who ends the stop-work.
 *
 * So the expired state stops shouting — the banner visibly clears, which is the acceptance
 * criterion — but it never says "safe to resume". It says the warning lapsed and names who
 * decides. A banner that quietly vanished would be read as permission by a worker who
 * simply looked away for a minute.
 *
 * `now` is a prop rather than a `useNow` call inside this component. The screen also needs
 * to know whether the window has lapsed — it drives the heat plan's suspended state — and
 * two independent clocks can disagree for a tick, which would show an expired banner above
 * a still-suspended heat plan. One clock, passed down, cannot.
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import AnimatedIcon from "../feedback/AnimatedIcon";
import { useTheme } from "@/theme/ThemeProvider";
import { formatTime, hasElapsed, minutesUntil, secondsUntil } from "@/helpers/dateTime";
import type { LightningRisk } from "@/types/domain";

interface LightningBannerProps {
  risk: LightningRisk;
  /** BCP-47 tag for time formatting. */
  locale: string;
  /** Epoch ms, ticking. Owned by the screen — see the note above. */
  now: number;
}

const LightningBanner: FC<LightningBannerProps> = ({ risk, locale, now }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const expired = hasElapsed(risk.validUntil, now);
  const active = !expired && risk.state !== "CLEAR";
  const stopWork = active && risk.state === "STOP_WORK";

  /*
   * A stop-work banner is filled rather than outlined, and it is the only element on the
   * screen that is. Outline-and-tint is what everything else uses, so an inversion carries
   * at arm's length in sun where a colour difference alone does not.
   */
  const accent = expired
    ? theme.colors.textSecondary
    : risk.state === "STOP_WORK"
      ? theme.colors.danger
      : risk.state === "ADVISORY"
        ? theme.colors.warning
        : theme.colors.success;

  const filled = stopWork;
  const foreground = filled ? theme.colors.textInverse : accent;

  const icon = expired
    ? "time-outline"
    : risk.state === "STOP_WORK"
      ? "flash"
      : risk.state === "ADVISORY"
        ? "warning"
        : "checkmark-circle";

  const title = expired
    ? t("lightning.expiredTitle")
    : risk.state === "STOP_WORK"
      ? t("lightning.stopWorkTitle")
      : risk.state === "ADVISORY"
        ? t("lightning.advisoryTitle")
        : t("lightning.clearTitle");

  const body = expired
    ? t("lightning.expiredBody", { time: formatTime(risk.validUntil, locale) })
    : risk.state === "STOP_WORK"
      ? t("lightning.stopWorkBody")
      : risk.state === "ADVISORY"
        ? t("lightning.advisoryBody")
        : t("lightning.clearBody", { time: formatTime(risk.observedAt, locale) });

  /*
   * Under a minute the countdown switches to seconds. "Expires in 0 min" for the last
   * fifty-nine seconds of a stop-work reads as though it has already gone, which is the
   * one direction the error must not run.
   */
  const remainingSeconds = secondsUntil(risk.validUntil, now);
  const countdown = expired
    ? null
    : remainingSeconds < 60
      ? t("lightning.expiresInSeconds", { seconds: remainingSeconds })
      : t("lightning.expiresInMinutes", { minutes: minutesUntil(risk.validUntil, now) });

  return (
    <View
      // Announced as an alert only while it is one — a screen reader should not interrupt
      // for an expired notice or a clear state.
      accessibilityRole={stopWork ? "alert" : "text"}
      accessibilityLabel={`${title}. ${body}`}
      style={[
        styles.container,
        {
          backgroundColor: filled ? accent : theme.colors.surface,
          borderColor: accent,
          borderWidth: filled ? theme.metrics.borderWidth : theme.metrics.borderWidth + 1,
          borderRadius: theme.metrics.radius,
        },
      ]}
    >
      <View style={styles.headerRow}>
        {/* The one place in the app where a looping animation is unambiguously earned. An
            expired or clear banner stays still — motion there would keep drawing the eye to
            something that no longer needs it. */}
        <AnimatedIcon
          name={icon}
          size={s(stopWork ? 30 : 24)}
          color={foreground}
          motion={stopWork ? "urgent" : active ? "steady" : "none"}
        />
        {/* flex:1 so a long translated title wraps inside the banner instead of pushing
            the icon off its edge — the Hindi stop-work title is nearly twice the English. */}
        <AppText
          variant={stopWork ? "title" : "subtitle"}
          style={[styles.title, { color: foreground }]}
        >
          {title}
        </AppText>
      </View>

      <AppText variant="body" style={[styles.body, { color: foreground }]}>
        {body}
      </AppText>

      <View style={styles.metaRow}>
        {risk.nearestStrikeKm !== null && !expired ? (
          <AppText variant="caption" style={[styles.meta, { color: foreground }]}>
            {t("lightning.nearestStrike", { km: risk.nearestStrikeKm.toFixed(1) })}
          </AppText>
        ) : null}

        <AppText variant="caption" style={[styles.meta, { color: foreground }]}>
          {t("lightning.observedAt", { time: formatTime(risk.observedAt, locale) })}
        </AppText>

        {countdown ? (
          <AppText variant="caption" style={[styles.meta, { color: foreground }]}>
            {countdown}
          </AppText>
        ) : null}
      </View>
    </View>
  );
};

export default LightningBanner;

const styles = StyleSheet.create({
  container: {
    width: "100%",
    padding: s(14),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
    marginStart: s(10),
  },
  body: {
    marginTop: vs(8),
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: vs(10),
  },
  meta: {
    // Wrapping row rather than a fixed three columns: at a large text scale these no longer
    // fit side by side, and a fixed row would clip rather than reflow.
    marginEnd: s(14),
    marginTop: vs(2),
  },
});
