/**
 * The worker's shift screen — SCRUM-172's home.
 *
 * ── ORDER IS THE REQUIREMENT ────────────────────────────────────────────────────────────
 * FR-12a puts the lightning warning above the WBGT reading, and §7.1 evaluates lightning
 * before any WBGT rule. So the banner is the first child of the scroll view, unconditionally
 * — not sorted by severity, not moved by any state. A worker who opens this screen mid-storm
 * sees the stop-work before anything else, without scrolling.
 *
 * The heat plan below it is suspended, in words, whenever a stop-work is active. See
 * `HeatGuidance` for why dimming alone was not enough.
 *
 * ── EVERYTHING HERE IS MOCKED ───────────────────────────────────────────────────────────
 * None of the three endpoints this screen needs exists: lightning (SCRUM-170), site
 * conditions (§12.1), or `GET /api/v1/shifts/me` (SCRUM-162, contract written, no
 * controller). Each is documented at its call site in `api/endpoints/safety.ts`. The
 * simulated badge on the reading and the notice below it are not placeholders to remove
 * later — FR-12 requires that marker whenever data is not live.
 */
import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppLoader from "@/components/feedback/AppLoader";
import MessageBanner from "@/components/feedback/MessageBanner";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";
import LightningBanner from "@/components/safety/LightningBanner";
import FreshnessNotice from "@/components/safety/FreshnessNotice";
import WbgtCard from "@/components/safety/WbgtCard";
import HeatGuidance from "@/components/safety/HeatGuidance";
import ShiftCard from "@/components/safety/ShiftCard";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { loadWorkerSafety } from "@/store/reducers/safetySlice";
import { useNow } from "@/hooks/useNow";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { hasElapsed } from "@/helpers/dateTime";
import {
  getFreshnessScenario,
  getLightningScenario,
  setFreshnessScenario,
  setLightningScenario,
  type LightningScenario,
} from "@/api/mock/scenario";
import type { WeatherQualityStatus } from "@/types/domain";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

const SCENARIOS: { key: LightningScenario; labelKey: string }[] = [
  { key: "clear", labelKey: "dev.scenarioClear" },
  { key: "advisory", labelKey: "dev.scenarioAdvisory" },
  { key: "stop-work", labelKey: "dev.scenarioStopWork" },
];

/** Every FR-12 freshness state, so each banner tone is reachable in review. */
const FRESHNESS_OPTIONS: WeatherQualityStatus[] = ["LIVE", "DELAYED", "STALE", "SIMULATED"];

export default function MyShiftScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);
  const { status, shift, lightning, conditions, policy, errorKey, requestId, refreshing } =
    useAppSelector((state) => state.safety);

  /*
   * One clock for the screen, ticking every second.
   *
   * A second is finer than a validity window needs, but it is what makes the last minute of
   * a stop-work count down visibly rather than jumping. The cost is a re-render of a handful
   * of views per second on one screen, which is not a cost worth optimising away on the
   * screen whose entire job is telling someone when to stop working.
   */
  const now = useNow(1000);

  const load = useCallback(
    (isRefresh: boolean) => {
      if (!user) return;
      void dispatch(loadWorkerSafety({ workerId: user.id, refreshing: isRefresh }));
    },
    [dispatch, user],
  );

  /*
   * Polled, not fetched once.
   *
   * The lightning banner clears itself when its window lapses, but only the server knows
   * whether a *new* assessment has been issued since. Without this the worker would sit on
   * an expired warning through a second storm — the clock makes the banner honest, the poll
   * makes it current.
   */
  useAutoRefresh(
    useCallback(() => load(false), [load]),
    REFRESH_INTERVALS.SHIFT_MS,
  );

  const onChangeScenario = (scenario: LightningScenario) => {
    setLightningScenario(scenario);
    // Re-fetch rather than mutating state in place: the validity window is computed at
    // fetch time, exactly as a real response's would be, so the countdown restarts the way
    // a fresh server assessment would.
    load(true);
  };

  const onChangeFreshness = (status: WeatherQualityStatus) => {
    setFreshnessScenario(status);
    load(true);
  };

  const stopWorkActive =
    lightning !== null &&
    lightning.state === "STOP_WORK" &&
    !hasElapsed(lightning.validUntil, now);

  if (status === "loading") {
    return (
      <AppSafeView>
        <AppLoader fullscreen message={t("common.loading")} />
      </AppSafeView>
    );
  }

  return (
    <AppSafeView>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        {status === "error" ? (
          <View style={styles.block}>
            <MessageBanner
              message={t(errorKey ?? "errors.unknown")}
              tone="danger"
              requestId={requestId}
            />
            <AppButton
              title={t("common.retry")}
              onPress={() => load(false)}
              style={styles.retry}
            />
          </View>
        ) : null}

        {/* First child, always. This is the requirement, not a layout preference. */}
        {lightning ? (
          <LightningBanner risk={lightning} locale={i18n.language} now={now} />
        ) : null}

        {shift === null && status === "ready" ? (
          <View style={styles.empty}>
            <AppText variant="title" style={styles.emptyTitle}>
              {t("shift.noShiftTitle")}
            </AppText>
            <AppText variant="body" tone="secondary" style={styles.emptyBody}>
              {t("shift.noShiftBody")}
            </AppText>
          </View>
        ) : null}

        {/* Above the reading, below the lightning banner. The order is the argument: a
            worker should know whether to trust the number before they read it, and nothing
            outranks the stop-work warning. */}
        {conditions ? (
          <View style={styles.block}>
            <FreshnessNotice status={conditions.qualityStatus} />
          </View>
        ) : null}

        {conditions ? (
          <WbgtCard
            conditions={conditions}
            policy={policy}
            locale={i18n.language}
            superseded={stopWorkActive}
          />
        ) : null}

        {policy ? <HeatGuidance policy={policy} suspended={stopWorkActive} /> : null}

        {shift ? <ShiftCard shift={shift} locale={i18n.language} /> : null}

        {__DEV__ ? (
          <View
            style={[
              styles.devPanel,
              { borderTopColor: theme.colors.border, borderTopWidth: theme.metrics.borderWidth },
            ]}
          >
            <AppText variant="caption" tone="secondary" style={styles.devLabel}>
              {t("dev.scenarioLabel")}
            </AppText>
            {SCENARIOS.map((option) => (
              <RadioWithTitle
                key={option.key}
                title={t(option.labelKey)}
                selected={option.key === getLightningScenario()}
                onPress={() => onChangeScenario(option.key)}
              />
            ))}

            <AppText variant="caption" tone="secondary" style={styles.devLabel}>
              {t("dev.freshnessLabel")}
            </AppText>
            {FRESHNESS_OPTIONS.map((option) => (
              <RadioWithTitle
                key={option}
                title={t(`freshness.${option}`)}
                selected={option === getFreshnessScenario()}
                onPress={() => onChangeFreshness(option)}
              />
            ))}
          </View>
        ) : null}
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
  block: {
    marginTop: vs(12),
  },
  retry: {
    marginTop: vs(12),
  },
  empty: {
    alignItems: "center",
    paddingVertical: vs(32),
  },
  emptyTitle: {
    textAlign: "center",
  },
  emptyBody: {
    textAlign: "center",
    marginTop: vs(8),
  },
  devPanel: {
    marginTop: vs(28),
    paddingTop: vs(12),
  },
  devLabel: {
    marginBottom: vs(8),
  },
});
