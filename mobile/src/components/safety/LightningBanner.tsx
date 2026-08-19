/**
 * The lightning stop-work banner (SCRUM-172, FR-12a).
 *
 * Four rendered states from two inputs — the risk state and whether the validity window has
 * lapsed:
 *
 *   STOP_WORK, active    loudest thing on the screen. Filled red, largest icon, urgent pulse.
 *   ADVISORY,  active    filled amber. "be ready to stop", not "stop".
 *   CLEAR,     active    filled green. Confirmation that the site was assessed, not silence.
 *   any,       expired   outlined and muted, and explicitly *not* an all-clear.
 *
 * ── STOP-WORK NO LONGER OUTRANKS BY FILL ALONE ──────────────────────────────────────────
 * All three live states are filled, so the inversion that used to make stop-work unique now
 * only separates live from expired. What still ranks stop-work above the other two is
 * deliberate and must not be flattened in the name of consistency: a larger icon (30 vs 24),
 * a `title` rather than `subtitle` heading, and the urgent pulse against advisory's steady
 * one and clear's stillness.
 *
 * That redundancy is the point. Colour is the first thing to wash out in glare and the first
 * thing to fail for a red-green colour-blind worker, so red-versus-amber cannot be the only
 * thing distinguishing "stop now" from "be ready to stop". Size and tempo survive both.
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
 *
 * @author Justin Chua
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

type LightningPresentation = {
  tone: "expired" | "danger" | "warning" | "success";
  icon: "time-outline" | "flash" | "warning" | "checkmark-circle";
  titleKey: string;
  bodyKey: string;
  motion: "urgent" | "steady" | "none";
  iconSize: 24 | 30;
  accessibilityRole: "alert" | "text";
  countdownMode: "seconds" | "minutes" | null;
  filled: boolean;
  stopWork: boolean;
  titleVariant: "title" | "subtitle";
};

export function resolveLightningPresentation({
  state,
  expired,
  remainingSeconds,
}: {
  state: LightningRisk["state"];
  expired: boolean;
  remainingSeconds: number;
}): LightningPresentation {
  if (expired) {
    return {
      tone: "expired",
      icon: "time-outline",
      titleKey: "lightning.expiredTitle",
      bodyKey: "lightning.expiredBody",
      motion: "none",
      iconSize: 24,
      accessibilityRole: "text",
      countdownMode: null,
      filled: false,
      stopWork: false,
      titleVariant: "subtitle",
    };
  }

  const live = {
    STOP_WORK: {
      tone: "danger",
      icon: "flash",
      titleKey: "lightning.stopWorkTitle",
      bodyKey: "lightning.stopWorkBody",
      motion: "urgent",
      iconSize: 30,
      accessibilityRole: "alert",
      filled: true,
      stopWork: true,
      titleVariant: "title",
    },
    ADVISORY: {
      tone: "warning",
      icon: "warning",
      titleKey: "lightning.advisoryTitle",
      bodyKey: "lightning.advisoryBody",
      motion: "steady",
      iconSize: 24,
      accessibilityRole: "text",
      filled: true,
      stopWork: false,
      titleVariant: "subtitle",
    },
    CLEAR: {
      tone: "success",
      icon: "checkmark-circle",
      titleKey: "lightning.clearTitle",
      bodyKey: "lightning.clearBody",
      motion: "none",
      iconSize: 24,
      accessibilityRole: "text",
      filled: true,
      stopWork: false,
      titleVariant: "subtitle",
    },
  } satisfies Record<LightningRisk["state"], Omit<LightningPresentation, "countdownMode">>;

  return {
    ...live[state],
    countdownMode: remainingSeconds < 60 ? "seconds" : "minutes",
  };
}

const LightningBanner: FC<LightningBannerProps> = ({ risk, locale, now }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const expired = hasElapsed(risk.validUntil, now);
  const remainingSeconds = secondsUntil(risk.validUntil, now);
  const presentation = resolveLightningPresentation({
    state: risk.state,
    expired,
    remainingSeconds,
  });

  /*
   * Every live state is filled rather than outlined; only an expired one is not.
   *
   * The banner as a whole is the loudest thing on the screen, and outline-and-tint is what
   * every other card uses — so the inversion is what separates "the site has been assessed"
   * from "here is some information", at arm's length in sun where a colour difference alone
   * does not carry.
   *
   * Expired deliberately keeps the outline. It is explicitly *not* an all-clear (see the
   * note at the top of this file), and giving a lapsed assessment the same visual weight as
   * a live one would be the one misreading that matters.
   *
   * ── WHY THE FILL IS NOT ALWAYS `accent` ─────────────────────────────────────────────
   * `accent` is the colour of this state on a light surface — border, and text when there
   * is no fill. It is chosen to be legible *on* white. A fill has to be legible *under*
   * white, which is the opposite constraint, and for amber the two do not coincide:
   * `warning` is 4.24:1 against white, below the 4.5:1 floor for normal text. `warningFill`
   * is the darkened value that clears it. Danger and success need no such split, so they
   * do not get one.
   */
  const accentByTone = {
    expired: theme.colors.textSecondary,
    danger: theme.colors.danger,
    warning: theme.colors.warning,
    success: theme.colors.success,
  };
  const accent = accentByTone[presentation.tone];
  const fill = presentation.tone === "warning" ? theme.colors.warningFill : accent;
  const foreground = presentation.filled ? theme.colors.textInverse : accent;
  const title = t(presentation.titleKey);
  let body: string;
  if (presentation.tone === "expired") {
    body = t(presentation.bodyKey, { time: formatTime(risk.validUntil, locale) });
  } else if (presentation.tone === "success") {
    body = t(presentation.bodyKey, { time: formatTime(risk.observedAt, locale) });
  } else {
    body = t(presentation.bodyKey);
  }

  /*
   * Under a minute the countdown switches to seconds. "Refreshes in 0 min" for the last
   * fifty-nine seconds of a stop-work reads as though it has already gone, which is the
   * one direction the error must not run.
   *
   * ── WHY "REFRESHES IN" AND NOT "EXPIRES IN" ─────────────────────────────────────────
   * The clock is unchanged; only the promise it makes is. "Expires" invited the reading
   * that the *hazard* ends at zero, when what lapses is the server's assessment — and the
   * screen polls for a new one at that point (see `useAutoRefresh` on the shift screen).
   * "Refreshes" describes what the worker will actually observe: the number reaching zero
   * and the banner re-stating itself, rather than a warning being lifted. Only a
   * supervisor lifts a stop-work; see the note at the top of this file.
   */
  let countdown: string | null = null;
  if (presentation.countdownMode === "seconds") {
    countdown = t("lightning.refreshesInSeconds", { seconds: remainingSeconds });
  } else if (presentation.countdownMode === "minutes") {
    countdown = t("lightning.refreshesInMinutes", {
      minutes: minutesUntil(risk.validUntil, now),
    });
  }

  return (
    <View
      // Announced as an alert only while it is one — a screen reader should not interrupt
      // for an expired notice or a clear state.
      accessibilityRole={presentation.accessibilityRole}
      accessibilityLabel={`${title}. ${body}`}
      style={[
        styles.container,
        {
          backgroundColor: presentation.filled ? fill : theme.colors.surface,
          // Matched to the fill, not to `accent`: on an advisory those now differ, and a
          // brighter amber ring around a darker amber block reads as an unintended halo.
          borderColor: presentation.filled ? fill : accent,
          borderWidth: presentation.filled ? theme.metrics.borderWidth : theme.metrics.borderWidth + 1,
          borderRadius: theme.metrics.radius,
        },
      ]}
    >
      <View style={styles.headerRow}>
        {/* The one place in the app where a looping animation is unambiguously earned. An
            expired or clear banner stays still — motion there would keep drawing the eye to
            something that no longer needs it.

            The icon needs no recolouring for the filled advisory and clear states: it draws
            in `foreground`, so it turns white alongside the text and inherits exactly the
            same contrast against the fill. Swapping in a different glyph set would solve a
            problem that does not exist.

            The size difference below is load-bearing now that all three states are filled —
            see the note at the top of this file.

            `essential` on the stop-work case only, and for the same reason the pulse exists
            at all. Since SCRUM-199 the in-app Reduce Motion preference defaults to on, so
            without this the pulse would be absent for every worker who has never opened
            Settings — a warning quietly weakened by a default they did not choose. The
            advisory pulse is not exempt: "be ready to stop" can afford to be still, and an
            exemption that covers every state is not an exemption. A device-level Reduce
            Motion still stops both. */}
        <AnimatedIcon
          name={presentation.icon}
          size={s(presentation.iconSize)}
          color={foreground}
          motion={presentation.motion}
          essential={presentation.stopWork}
        />
        {/* flex:1 so a long translated title wraps inside the banner instead of pushing
            the icon off its edge — the Hindi stop-work title is nearly twice the English. */}
        <AppText
          variant={presentation.titleVariant}
          style={[styles.title, { color: foreground }]}
        >
          {title}
        </AppText>
      </View>

      <AppText variant="body" style={[styles.body, { color: foreground }]}>
        {body}
      </AppText>

      {/*
        The countdown is all that is left here.

        Strike distance and the observation time were removed at the product owner's
        request: at arm's length in sun the banner has one job, and three timestamps and a
        distance competed with the instruction above them for the glance that matters.
        `nearestStrikeKm` and `observedAt` are still on the wire and still in
        `LightningRisk` — they belong in the audit trail and in a supervisor view, not on
        the worker's stop-work notice.
      */}
      {countdown ? (
        <View style={styles.metaRow}>
          <AppText variant="caption" style={[styles.meta, { color: foreground }]}>
            {countdown}
          </AppText>
        </View>
      ) : null}
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
