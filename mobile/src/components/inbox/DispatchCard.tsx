/**
 * One approved action, and the tap that acknowledges it.
 *
 * ── ONE TAP MEANS ONE TAP ───────────────────────────────────────────────────────────────
 * No confirmation dialog. SCRUM-186 asks for one-tap acknowledgement, and a "are you sure?"
 * step would be actively wrong here: acknowledging is not destructive, it is not
 * irreversible in any way the worker cares about, and the person doing it is wearing gloves
 * on a hot site. A second tap is friction with no safety return.
 *
 * The safety comes from idempotency instead. Because the same key is replayed, a worker who
 * taps three times because nothing seemed to happen produces exactly one acknowledgement —
 * which is a better answer to double-tapping than a dialog.
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "../texts/AppText";
import AppButton from "../buttons/AppButton";
import AnimatedIcon from "../feedback/AnimatedIcon";
import { useTheme } from "@/theme/ThemeProvider";
import { cardSurface } from "@/styles/sharedStyles";
import { formatTime } from "@/helpers/dateTime";
import type { ActionDispatch } from "@/types/domain";

interface DispatchCardProps {
  dispatch: ActionDispatch;
  acknowledgedAt: string | null;
  inFlight: boolean;
  /** i18n key for a failed attempt on this card, or null. */
  failureKey: string | null;
  onAcknowledge: () => void;
  locale: string;
}

const DispatchCard: FC<DispatchCardProps> = ({
  dispatch,
  acknowledgedAt,
  inFlight,
  failureKey,
  onAcknowledge,
  locale,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const acknowledged = acknowledgedAt !== null;

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
      ]}
    >
      <View style={styles.headerRow}>
        <AnimatedIcon
          name={acknowledged ? "checkmark-circle" : "arrow-forward-circle"}
          size={s(22)}
          color={acknowledged ? theme.colors.success : theme.colors.textPrimary}
          // Pops once when it flips to acknowledged, then stays still. A pending action does
          // not pulse: three of them pulsing at once would be a nervous screen, and the
          // urgency lives in the lightning banner, not here.
          motion={acknowledged ? "pop" : "none"}
          style={styles.headerIcon}
        />
        {/* flex:1 so a long action title wraps rather than pushing the timestamp away. */}
        <AppText variant="subtitle" style={styles.title}>
          {/* Falls back to the raw code: `action_code` is deliberately not CHECK-constrained
              server-side (see V3__domain_schema.sql), so the catalogue can grow ahead of
              this app's translations. An untranslated instruction is recoverable; a blank
              one is not. */}
          {t(`actions.${dispatch.actionCode}`, { defaultValue: dispatch.actionCode })}
        </AppText>
      </View>

      <AppText variant="body" style={styles.instruction}>
        {dispatch.instruction ?? t("inbox.noInstruction")}
      </AppText>

      {/*
        Two fixed columns, top-aligned — not a wrapping row.

        `flexWrap` here relied on the row measuring the height of a child whose *own* text
        wrapped internally, and on Android that came out one line short: "acknowledgement"
        rendered below the row's measured box and the Acknowledge button drew straight over
        it. Two columns with an explicit `flex` remove the guesswork — the status column has
        a real width to wrap inside, so the row's height is the height of its tallest child
        and nothing renders outside it.

        `alignItems: "flex-start"` is what puts both labels on the same horizontal axis, so
        "Sent 07:48" and "Awaiting your acknowledgement" start on the same line however many
        lines the second one runs to.
      */}
      <View style={styles.metaRow}>
        <AppText variant="caption" tone="secondary" style={styles.metaSent}>
          {t("inbox.dispatchedAt", { time: formatTime(dispatch.dispatchedAt, locale) })}
        </AppText>
        <AppText
          variant="caption"
          tone={acknowledged ? "success" : "secondary"}
          style={styles.metaStatus}
        >
          {acknowledged
            ? t("inbox.acknowledged", { time: formatTime(acknowledgedAt, locale) })
            : t("inbox.pending")}
        </AppText>
      </View>

      {failureKey ? (
        <View style={styles.failure}>
          <AppText variant="label" tone="danger">
            {t(failureKey)}
          </AppText>
          {/* The reassurance is the point of the whole key. A worker who has just seen an
              error has every reason to fear that tapping again sends it twice. */}
          <AppText variant="caption" tone="secondary" style={styles.safeToRetry}>
            {t("inbox.safeToRetry")}
          </AppText>
        </View>
      ) : null}

      {!acknowledged ? (
        <AppButton
          title={
            inFlight
              ? t("inbox.acknowledging")
              : failureKey
                ? t("inbox.retryButton")
                : t("inbox.acknowledgeButton")
          }
          onPress={onAcknowledge}
          // AppButton treats `loading` as disabled, so this both spins and blocks the
          // press. The thunk's `condition` guard is the real defence — a tap can land
          // before React commits this — but there is no reason to accept the tap either.
          loading={inFlight}
          style={styles.action}
          // Only after a failure. Saying "tapping again is safe" before the first attempt
          // answers a question nobody has asked yet.
          accessibilityHint={failureKey ? t("inbox.safeToRetry") : undefined}
        />
      ) : null}
    </View>
  );
};

export default DispatchCard;

const styles = StyleSheet.create({
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIcon: {
    marginEnd: s(10),
  },
  title: {
    flex: 1,
  },
  instruction: {
    marginTop: vs(8),
  },
  metaRow: {
    flexDirection: "row",
    // Both labels start on the same horizontal axis regardless of how many lines the
    // status text runs to.
    alignItems: "flex-start",
    marginTop: vs(10),
    // Clearance below the row as well as above the button. Belt and braces: a single
    // margin on one side is one measurement away from overlapping again.
    marginBottom: vs(6),
  },
  metaSent: {
    // Never shrinks — a timestamp is short and fixed, and squeezing it would wrap
    // "Sent 07:48" onto two lines before the status text had run out of room.
    flexShrink: 0,
    marginEnd: s(12),
  },
  metaStatus: {
    // Takes the remaining width, so its text wraps inside its own column rather than
    // pushing the row wider than the card.
    flex: 1,
  },
  failure: {
    marginTop: vs(10),
  },
  safeToRetry: {
    marginTop: vs(2),
  },
  action: {
    marginTop: vs(12),
  },
});
