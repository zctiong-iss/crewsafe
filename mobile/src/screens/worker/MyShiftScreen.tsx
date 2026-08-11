/**
 * The worker's shift screen — SCRUM-172's home.
 *
 * ── ORDER IS THE REQUIREMENT ────────────────────────────────────────────────────────────
 * FR-12a puts the lightning warning above the WBGT reading, and §7.1 evaluates lightning
 * before any WBGT rule. So the banner is the first child of the scroll view, unconditionally
 * — not sorted by severity, not moved by any state. A worker who opens this screen mid-storm
 * sees the stop-work before anything else, without scrolling.
 *
 * The rest of the order is a product decision and was changed after review: the task the
 * worker is actually doing now sits directly under the banner, and heat conditions moved to
 * the bottom. FR-12a is still satisfied — it constrains lightning to be *above* the WBGT
 * reading, which moving the reading further down only reinforces.
 *
 * The heat plan that used to sit between them is behind `features.heatGuidanceCard`, which
 * is currently off. Read that flag before assuming this screen is complete: the "suspended
 * during a stop-work" wording lives there, and `WbgtCard`'s own superseded label is what
 * carries it while the card is hidden.
 *
 * ── EVERYTHING HERE IS MOCKED ───────────────────────────────────────────────────────────
 * None of the three endpoints this screen needs exists: lightning (SCRUM-170), site
 * conditions (§12.1), or `GET /api/v1/shifts/me` (SCRUM-162, contract written, no
 * controller). Each is documented at its call site in `api/endpoints/safety.ts`. The
 * simulated badge on the reading and the notice below it are not placeholders to remove
 * later — FR-12 requires that marker whenever data is not live.
 *
 * @author Justin Chua
 */
import { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
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
import WellbeingLogCard from "@/components/wellbeing/WellbeingLogCard";
import RaiseConcernSheet from "@/components/wellbeing/RaiseConcernSheet";
import HeatGuidance from "@/components/safety/HeatGuidance";
import ShiftCard from "@/components/safety/ShiftCard";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { logWellbeing, raiseConcern } from "@/store/reducers/wellbeingSlice";
import { showToast } from "@/store/reducers/uiSlice";
import { isMockApi } from "@/auth/authMode";
import { loadWorkerSafety } from "@/store/reducers/safetySlice";
import { useNow } from "@/hooks/useNow";
import { useAutoRefresh, REFRESH_INTERVALS } from "@/hooks/useAutoRefresh";
import { hasElapsed } from "@/helpers/dateTime";
import {
  getFreshnessScenario,
  getLightningScenario,
  getLightningSource,
  setFreshnessScenario,
  setLightningScenario,
  setLightningSource,
  type LightningScenario,
  type LightningSource,
} from "@/api/mock/scenario";
import type { WeatherQualityStatus } from "@/types/domain";
import { features } from "@/constants/features";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

const LIGHTNING_SOURCES: LightningSource[] = ["live", "simulated"];

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

  /* US-11. `justLogged` is only ever this device's own feedback — the supervisor's view reads the
     server — but it is what stops a worker in gloves pressing twice because nothing happened. */
  const {
    justLogged,
    loggingType,
    raisingConcern: sendingConcern,
    errorKey: wellbeingErrorKey,
  } = useAppSelector((state) => state.wellbeing);
  const [raisingConcern, setRaisingConcern] = useState(false);

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

  const onChangeSource = (source: LightningSource) => {
    setLightningSource(source);
    load(true);
  };

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
        {/*
          Null is not "clear" — it is "the server has no lightning data for this site", which
          happens when the ingestion scheduler is off. Rendering nothing there would be the
          same absence of a warning that a genuine all-clear produces, so it is said out loud.
          Only when there is a shift: with no shift there is no site to have data about.
        */}
        {!lightning && shift ? (
          <View style={styles.block}>
            <MessageBanner message={t("lightning.unavailable")} tone="warning" />
          </View>
        ) : null}

        {lightning ? (
          <LightningBanner risk={lightning} locale={i18n.language} now={now} />
        ) : null}

        {/* Directly under the banner: what this worker is doing right now, which is the
            thing they opened the screen for. Above the heat reading by product decision —
            FR-12a only constrains lightning to sit above the reading, not the task. */}
        {shift ? <ShiftCard shift={shift} locale={i18n.language} /> : null}

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

        {/* Off by default — see `features.heatGuidanceCard` for what is lost while it is.
            Rendered from a flag rather than commented out so it stays typechecked. */}
        {features.heatGuidanceCard && policy ? (
          <HeatGuidance policy={policy} suspended={stopWorkActive} />
        ) : null}

        {/* Heat conditions last, and the freshness notice stays immediately above it: a
            worker should know whether to trust the number before they read it, so the two
            move together or not at all. */}
        {conditions ? (
          <View style={styles.block}>
            <FreshnessNotice status={conditions.qualityStatus} />
          </View>
        ) : null}

        {conditions ? (
          <WbgtCard conditions={conditions} superseded={stopWorkActive} />
        ) : null}

        {/*
          US-11, and below the readings on purpose.

          A worker opens this screen to find out whether it is safe to keep working; logging what
          they have already done is the second question, not the first. It needs a shift for the
          same reason everything else here does — a log has to belong to a crew, and without one
          there is nothing to log against.
        */}
        {shift ? (
          <WellbeingLogCard
            justLogged={justLogged}
            loggingType={loggingType}
            errorKey={wellbeingErrorKey}
            onLog={(logType) => void dispatch(logWellbeing({ shiftId: shift.shiftId, logType }))}
            onRaiseConcern={() => setRaisingConcern(true)}
          />
        ) : null}

        {__DEV__ ? (
          <View
            style={[
              styles.devPanel,
              { borderTopColor: theme.colors.border, borderTopWidth: theme.metrics.borderWidth },
            ]}
          >
            {/*
              Absent in mock auth mode, where there is nothing to switch to: that mode never
              touches the network, so "live" would be a button that changed nothing.
            */}
            {!isMockApi() ? (
              <>
                <AppText variant="caption" tone="secondary" style={styles.devLabel}>
                  {t("dev.lightningSourceLabel")}
                </AppText>
                {LIGHTNING_SOURCES.map((option) => (
                  <RadioWithTitle
                    key={option}
                    title={t(`dev.lightningSource.${option}`)}
                    selected={option === getLightningSource()}
                    onPress={() => onChangeSource(option)}
                  />
                ))}
              </>
            ) : null}

            <AppText variant="caption" tone="secondary" style={styles.devLabel}>
              {t("dev.scenarioLabel")}
            </AppText>
            {SCENARIOS.map((option) => (
              <RadioWithTitle
                key={option.key}
                title={t(option.labelKey)}
                selected={option.key === getLightningScenario()}
                onPress={() => onChangeScenario(option.key)}
                /*
                  Disabled under Live, not hidden. A simulated scenario has no meaning against
                  a live feed, and a radio that still moves while changing nothing on screen is
                  how someone concludes the live data is broken.
                */
                disabled={!isMockApi() && getLightningSource() === "live"}
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

      <RaiseConcernSheet
        visible={raisingConcern}
        saving={sendingConcern}
        onCancel={() => setRaisingConcern(false)}
        onSend={(values) => {
          if (!shift) return;
          setRaisingConcern(false);
          void (async () => {
            const result = await dispatch(raiseConcern({ shiftId: shift.shiftId, input: values }));
            if (raiseConcern.fulfilled.match(result)) {
              /* Confirmed out loud. A worker who has just told someone they feel unwell needs to
                 know the message left the phone — the sheet closing looks the same either way. */
              dispatch(showToast({ messageKey: "wellbeing.concernSentToast", tone: "success" }));
              return;
            }
            Alert.alert(t("wellbeing.concernFailedTitle"),
              t(result.payload?.errorKey ?? "errors.unknown"), [{ text: t("common.close") }]);
          })();
        }}
      />
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
