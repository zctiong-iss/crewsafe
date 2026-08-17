/**
 * One proposed action on a drafted plan (SCRUM-119).
 *
 * ── THE CODE IS THE TEXT; THE PROSE IS THE FALLBACK ─────────────────────────────────────
 * `actionCode` resolves through `actions.*`, which ships in all seven locales — so a supervisor
 * reading in Tamil sees the same instruction their crew will receive, in Tamil. `action` is
 * server-authored English and is only rendered when a plan predates SCRUM-119 and carries no
 * code, with a note saying so rather than passing English off as a translation.
 *
 * Never parse `action` to recover a number. It works in English and fails in the other six —
 * the same trap SCRUM-206 documents for the rest timer.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import Pill from "@/components/common/Pill";
import Disclosure from "@/components/common/Disclosure";
import { formatTime } from "@/helpers/dateTime";
import { useTheme } from "@/theme/ThemeProvider";
import type { Mitigation } from "@/types/domain";

/**
 * How many worker chips render before the rest collapse into `+N`.
 *
 * Four fits two lines at fontScale 1.5 on a small phone. Past that the chips push the
 * disclosure control off-screen, which hides the evidence behind an invisible affordance.
 */
const MAX_WORKER_CHIPS = 4;

interface MitigationRowProps {
  mitigation: Mitigation;
  /**
   * Resolves a worker id to a name for `appliesTo` (SCRUM-118).
   *
   * Passed in rather than looked up here: the roster lives on the shift, and a presentational row
   * that reached into the store for it would be untestable in isolation and would couple every
   * caller to the shifts slice.
   */
  workerNameFor?: (workerId: string) => string;
  /** Struck through and dimmed, for a row the supervisor has taken out of the plan. */
  removed?: boolean;
  /** Hidden in the edit sheet, where the rationale would bury the controls. */
  showDetail?: boolean;
}

const MitigationRow: FC<MitigationRowProps> = ({
  mitigation,
  workerNameFor,
  removed = false,
  showDetail = true,
}) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  /*
   * `t()` with an explicit fallback rather than `humaniseActionCode`. A code the server knows and
   * this app does not is a contract drift worth showing honestly — the raw code plus the server's
   * own words — not smoothing over with a humanised guess that reads like a real instruction.
   */
  const label = mitigation.actionCode
    ? t(`actions.${mitigation.actionCode}`, { defaultValue: mitigation.action })
    : mitigation.action;

  const untranslated = mitigation.actionCode === null;

  /**
   * Timing as a phrase, composed from the typed fields (SCRUM-118 / #205).
   *
   * Never read out of `action`: that text is server-authored English, and a regex over it works in
   * English and fails in the other six locales — the trap SCRUM-206 documents for the rest timer.
   *
   * `everyMinutes === 60` gets its own phrase because "every hour" is how a person says it and
   * "every 60 min" is how a database does.
   */
  const timingPhrase = (() => {
    const timing = mitigation.timing;
    if (!timing) return null;

    const parts: string[] = [];
    if (timing.durationMinutes !== null) {
      parts.push(t("recommendations.timingDuration", { duration: timing.durationMinutes }));
    }
    if (timing.everyMinutes !== null) {
      parts.push(
        timing.everyMinutes === 60
          ? t("recommendations.timingEveryHour")
          : t("recommendations.timingEveryMinutes", { every: timing.everyMinutes }),
      );
    }
    if (timing.startByUtc) {
      parts.push(t("recommendations.timingStartBy", { time: formatTime(timing.startByUtc, i18n.language) }));
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  return (
    <View style={[styles.row, removed && styles.removed]}>
      <View style={styles.headline}>
        <AppText
          variant="body"
          style={[
            styles.label,
            removed
              ? { textDecorationLine: "line-through", color: theme.colors.textSecondary }
              : undefined,
          ]}
        >
          {label}
        </AppText>

        {/*
          Required vs suggested, as a badge rather than a footnote.

          This is the field that changes a decision: a MANDATORY action comes from the policy
          engine and is not a supervisor's to drop when they narrow a plan, while an ADVISORY one
          is the agent's own suggestion on top. Someone editing a plan needs to see that at a
          glance, not infer it from a rule reference being present.
        */}
        {mitigation.origin ? (
          <Pill
            role="attribute"
            tone={mitigation.origin === "MANDATORY" ? "danger" : "neutral"}
            label={
              mitigation.origin === "MANDATORY"
                ? t("recommendations.originMandatory")
                : t("recommendations.originAdvisory")
            }
          />
        ) : null}
      </View>

      {/* Timing next to the instruction it qualifies — "rest 15 minutes" means little without
          "every hour" beside it. */}
      {timingPhrase && !removed ? (
        <AppText variant="caption" tone="secondary" style={styles.notice}>
          {timingPhrase}
        </AppText>
      ) : null}

      {untranslated ? (
        <AppText variant="caption" tone="secondary" style={styles.notice}>
          {t("recommendations.untranslatedNotice")}
        </AppText>
      ) : null}

      {removed ? (
        <AppText variant="caption" tone="secondary" style={styles.notice}>
          {t("recommendations.removedLabel")}
        </AppText>
      ) : null}

      {showDetail && !removed ? (
        <MitigationDetail mitigation={mitigation} workerNameFor={workerNameFor} />
      ) : null}
    </View>
  );
};

export default MitigationRow;

/**
 * The summary chips plus the collapsible evidence (ADR-0017 §3).
 *
 * ── WHY `appliesTo` MOVED UP AND THE REST MOVED DOWN ────────────────────────────────────
 * These four fields used to render as one always-on block, which is the "big chunk" the
 * design language calls out: showing everything at once shows nothing. They split by what a
 * supervisor is doing. *Who it applies to* changes the decision — "these two people" versus
 * "the whole crew" — so it stays visible, now as chips rather than a comma-joined sentence.
 * Reason, rule and expected effect are the *evidence* behind the decision; they are read once,
 * when someone is actually judging the plan, so they sit behind an expand.
 *
 * ── A LOCAL COMPONENT, NOT INLINE JSX ───────────────────────────────────────────────────
 * The disclosure needs its own `open` state. Hoisting that into `MitigationRow` would make
 * the parent re-render on every expand, and hoisting it into the list above would make one
 * row's state the list's problem.
 */
const MitigationDetail: FC<{
  mitigation: Mitigation;
  workerNameFor?: (workerId: string) => string;
}> = ({ mitigation, workerNameFor }) => {
  const { t } = useTranslation();

  /* Absent OR empty means the whole shift — the server has expressed it both ways. */
  const appliesToAll = mitigation.appliesTo === null || mitigation.appliesTo.length === 0;
  const names = appliesToAll
    ? []
    : /* Falls back to the raw id rather than dropping the worker: `GET /workers` returns
         ACTIVE only, so someone since offboarded resolves to no name, and omitting them
         would understate who the action covers. */
      mitigation.appliesTo!.map((workerId) => workerNameFor?.(workerId) ?? workerId);
  const shown = names.slice(0, MAX_WORKER_CHIPS);
  const overflow = names.length - shown.length;

  const detailLabel = (open: boolean) =>
    open ? t("recommendations.hideDetails") : t("recommendations.showDetails");

  return (
    <>
      <View style={styles.chips}>
        {appliesToAll ? (
          <Pill role="entity" label={t("recommendations.appliesToAll")} />
        ) : (
          <>
            {shown.map((name, index) => (
              <Pill key={`${name}-${index}`} role="entity" label={name} />
            ))}
            {overflow > 0 ? <Pill role="entity" label={`+${overflow}`} /> : null}
          </>
        )}
      </View>

      {/* Uncontrolled: this row is the only thing that cares whether it is open, and it does
          not live in a virtualised list. */}
      <Disclosure label={detailLabel} accessibilityLabel={detailLabel}>
        <View>
          {mitigation.rationale ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">
                {t("recommendations.rationale")}
              </AppText>
              {/* Server prose, and unavoidably English — but it is evidence for the supervisor
                  judging the plan, not an instruction reaching a worker, so showing it is
                  better than hiding the reasoning the ticket exists to surface. */}
              <AppText variant="caption">{mitigation.rationale}</AppText>
            </View>
          ) : null}

          {/* FR-16: the rule that justifies this action, beside the action rather than in a
              footer, so judging one does not mean scrolling to find the other. Long codes such
              as UNACCLIMATISED_HEAVY_WORK_RULE wrap; they are never truncated. */}
          {mitigation.ruleReference ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">
                {t("recommendations.ruleReference")}
              </AppText>
              <AppText variant="caption">{mitigation.ruleReference}</AppText>
            </View>
          ) : null}

          {mitigation.estimatedImpact ? (
            <View style={styles.detail}>
              <AppText variant="caption" tone="secondary">
                {t("recommendations.estimatedImpact")}
              </AppText>
              <AppText variant="caption">{mitigation.estimatedImpact}</AppText>
            </View>
          ) : null}
        </View>
      </Disclosure>
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    paddingVertical: vs(6),
  },
  headline: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  label: {
    // Wraps rather than shoving the badge off the edge: an instruction is free text and grows
    // further at large text sizes.
    flex: 1,
    marginEnd: s(8),
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: s(6),
    marginTop: vs(6),
  },
  removed: {
    opacity: 0.6,
  },
  notice: {
    marginTop: vs(2),
  },
  detail: {
    marginTop: vs(6),
    paddingStart: s(8),
  },
});
