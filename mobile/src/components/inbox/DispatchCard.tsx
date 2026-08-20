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
 *
 * @author Justin Chua
 */
import { StyleSheet, View } from "react-native";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText, { lineHeightFor } from "../texts/AppText";
import AppButton from "../buttons/AppButton";
import AnimatedIcon from "../feedback/AnimatedIcon";
import RestProgressBar from "./RestProgressBar";
import { useExpiryTimer } from "@/hooks/useExpiryTimer";
import { useTheme } from "@/theme/ThemeProvider";
import { cardSurface } from "@/styles/sharedStyles";
import { formatTime } from "@/helpers/dateTime";
import { humaniseActionCode } from "@/helpers/actionCodes";
import { instructionKeyFor } from "@/helpers/actionInstruction";
import type { ActionDispatch } from "@/types/domain";

interface DispatchCardProps {
  dispatch: ActionDispatch;
  acknowledgedAt: string | null;
  inFlight: boolean;
  /** i18n key for a failed attempt on this card, or null. */
  failureKey: string | null;
  onAcknowledge: () => void;
  locale: string;
  /**
   * Epoch ms this action stops being owed, or null if it has no derivable end.
   *
   * Only meaningful once acknowledged — see `restDuration.ts` for where it comes from and
   * why it is never parsed out of the rendered title.
   */
  dismissAt?: number | null;
  /** Fired once when `dismissAt` passes. */
  onExpire?: () => void;
  /**
   * True only when `dismissAt` came from a parsed rest duration.
   *
   * Decides whether a progress bar is shown. A HYDRATE card and an unparseable REST code both
   * dwell before clearing, but neither is a rest the worker is serving — a bar on either
   * would be counting down to something that is not happening.
   */
  hasRestTimer?: boolean;
}

function acknowledgeTitle(
  inFlight: boolean,
  failureKey: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (inFlight) return t("inbox.acknowledging");
  if (failureKey) return t("inbox.retryButton");
  return t("inbox.acknowledgeButton");
}

function dispatchPresentation(
  acknowledged: boolean,
  inFlight: boolean,
  failureKey: string | null,
  acknowledgedAt: string | null,
  locale: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return {
    iconName: acknowledged ? ("checkmark-circle" as const) : ("arrow-forward-circle" as const),
    iconColorKey: acknowledged ? "success" : "textPrimary",
    motion: acknowledged ? ("pop" as const) : ("none" as const),
    statusTone: acknowledged ? ("success" as const) : ("secondary" as const),
    statusText: acknowledged
      ? t("inbox.acknowledged", { time: formatTime(acknowledgedAt ?? "", locale) })
      : t("inbox.pending"),
    acknowledgeTitle: acknowledgeTitle(inFlight, failureKey, t),
  };
}

/**
 * The instruction a worker reads.
 *
 * Kept out of the component so the fallback chain is one readable expression rather than a
 * nested ternary inside JSX: translated canned sentence → the server's own text → the
 * "no instruction" placeholder, which is the only one of the three that is not an instruction.
 */
function instructionText(instruction: string | null, t: (key: string) => string): string {
  const key = instructionKeyFor(instruction);
  if (key) return t(key);
  return instruction ?? t("inbox.noInstruction");
}

const DispatchCard: FC<DispatchCardProps> = ({
  dispatch,
  acknowledgedAt,
  inFlight,
  failureKey,
  onAcknowledge,
  locale,
  dismissAt = null,
  onExpire,
  hasRestTimer = false,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const acknowledged = acknowledgedAt !== null;

  /*
   * The bar appears only once the server has confirmed.
   *
   * Not while the request is in flight, and not after a failure. An action the supervisor
   * has not been told about must not look like an action already under way — a worker
   * watching a countdown believes their rest is being credited, and if the acknowledgement
   * never landed it is not.
   */
  const startedAt = acknowledgedAt ? Date.parse(acknowledgedAt) : Number.NaN;
  const showRestProgress =
    acknowledged &&
    hasRestTimer &&
    dismissAt !== null &&
    onExpire !== undefined &&
    !Number.isNaN(startedAt) &&
    dismissAt > startedAt;

  /*
   * The silent half of the same deadline.
   *
   * When a bar is on screen it already ticks once a second and reports its own completion, so
   * this stands down to avoid two things racing to dismiss one card. Everything else — every
   * non-rest code, and any rest we could not parse — has nothing to redraw, so it gets a
   * single timeout instead of 180 pointless renders over three minutes.
   */
  useExpiryTimer(dismissAt, onExpire ?? (() => {}), acknowledged && !showRestProgress);

  // Both scale with the device and with the user's text setting, so the icon stays on the
  // title's first line on a 320dp phone at 0.85x and a tablet at 1.5x alike.
  const iconSize = s(22);
  // `locale` is passed so the offset tracks the script's line box as well as the device and
  // text scale. Tamil, Bengali and Myanmar sit in a taller line than Latin, and an offset
  // computed without them is right in English and visibly out in three other languages.
  const iconTopOffset = Math.max(
    0,
    (lineHeightFor("subtitle", theme.fontScale, locale) - iconSize) / 2,
  );
  const presentation = dispatchPresentation(acknowledged, inFlight, failureKey, acknowledgedAt, locale, t);

  return (
    <View
      style={[
        styles.card,
        cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
        { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
      ]}
    >
      {/*
        The icon holds the first line's axis, whatever the title does.

        With `alignItems: "center"` the icon was centred against the *whole* title block, so
        a one-line title looked right and a two-line one (an untranslated code such as
        ROTATE_TO_LIGHT_DUTY) dropped the icon into the gap between the lines. Top-aligning
        and nudging down by half the difference between the line box and the icon puts it on
        the first line's optical centre instead.

        The offset is derived from `lineHeightFor`, not hardcoded, so it stays correct across
        device scaling (`s()`) and the user's own text-size setting — the two things that
        would otherwise silently break it on a smaller or larger phone.
      */}
      <View style={styles.headerRow}>
        <AnimatedIcon
          name={presentation.iconName}
          size={iconSize}
          color={acknowledged ? theme.colors.success : theme.colors.textPrimary}
          // Pops once when it flips to acknowledged, then stays still. A pending action does
          // not pulse: three of them pulsing at once would be a nervous screen, and the
          // urgency lives in the lightning banner, not here.
          motion={presentation.motion}
          style={[styles.headerIcon, { marginTop: iconTopOffset }]}
        />
        {/* flex:1 so a long action title wraps rather than pushing the timestamp away. */}
        <AppText variant="subtitle" style={styles.title}>
          {/* Falls back to a humanised form of the code rather than the raw code — see
              `humaniseActionCode`. An untranslated instruction is recoverable; a blank one
              is not, and a mid-word break with an orphaned letter reads as broken. */}
          {t(`actions.${dispatch.actionCode}`, {
            defaultValue: humaniseActionCode(dispatch.actionCode),
          })}
        </AppText>
      </View>

      {/*
        Translated when the server sent its canned sentence, shown verbatim when it did not.

        Matched on the TEXT rather than on `actionCode`, for two reasons that both matter. The
        dispatch code is the DISPATCH code — HYDRATE_HOURLY and HYDRATE_REGULARLY both arrive
        as HYDRATE with different sentences, so the code cannot choose between them. And a
        supervisor may have EDITED the plan before approving it, in which case this sentence is
        their wording; translating from the code would replace a deliberate safety instruction
        with a generic one. See `helpers/actionInstruction.ts`.
      */}
      <AppText variant="body" style={styles.instruction}>
        {instructionText(dispatch.instruction, t)}
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
          tone={presentation.statusTone}
          style={styles.metaStatus}
        >
          {presentation.statusText}
        </AppText>
      </View>

      {showRestProgress ? (
        <RestProgressBar
          startedAt={startedAt}
          dismissAt={dismissAt}
          onComplete={onExpire}
        />
      ) : null}

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
          title={presentation.acknowledgeTitle}
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
    // Not "center": that would centre the icon against a multi-line title. See the note at
    // the call site.
    alignItems: "flex-start",
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
