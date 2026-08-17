/**
 * One drafted plan, and the supervisor's decision on it (SCRUM-119 / US-09).
 *
 * ── THE EVIDENCE IS THE POINT ───────────────────────────────────────────────────────────
 * US-08's whole premise is that a supervisor should be able to *judge* a recommendation rather
 * than trust it. So the policy version and the agent's reasoning are shown above the actions, not
 * tucked behind a disclosure — a supervisor who has to go looking for the basis of a plan will
 * approve it without one.
 *
 * ── THREE DECISIONS, NOT ONE WITH VARIATIONS ────────────────────────────────────────────
 * Approve sends the draft as it stands. Edit sends a plan the supervisor has narrowed. Reject
 * sends nothing and records why. All three are terminal: the server refuses a second decision
 * with 409, and this screen surfaces that rather than papering over it, because the honest answer
 * to "someone already decided" is to show them what was decided.
 *
 * ── WHAT A DECIDED PLAN STILL SHOWS ─────────────────────────────────────────────────────
 * The draft, always — never overwritten by the decision. For an edited decision, both the draft
 * and what was actually approved, so "what did the supervisor change" is answerable months later
 * by anyone with read access. That is the retention half of the acceptance criteria.
 *
 * @author Justin Chua
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import MessageBanner from "@/components/feedback/MessageBanner";
import MitigationRow from "@/components/recommendations/MitigationRow";
import RecommendationStatusPill from "@/components/recommendations/RecommendationStatusPill";
import EditPlanSheet from "@/components/recommendations/EditPlanSheet";
import RejectSheet from "@/components/recommendations/RejectSheet";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { decideRecommendation, loadRecommendations } from "@/store/reducers/recommendationsSlice";
import { loadPolicyVersions } from "@/store/reducers/policySlice";
import { showToast } from "@/store/reducers/uiSlice";
import { formatDateTime } from "@/helpers/dateTime";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { Mitigation, MitigationCategory } from "@/types/domain";
import type { RecommendationsStackParamList } from "@/navigation/types";

/** The order topics are shown in: what stops work first, what sustains it after. */
const CATEGORY_ORDER: MitigationCategory[] = [
  "STOP_WORK",
  "REST",
  "HYDRATION",
  "SHADE_COOLING",
  "WORK_SCHEDULING",
  "MONITORING",
];

interface DecisionSectionProps {
  autoDispatched: boolean;
  decided: boolean;
  canDecide: boolean;
  deciding: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
}

/**
 * The bottom-of-screen decision affordance: exactly one of four mutually exclusive states.
 * Extracted out of {@link RecommendationDetailScreen} so those four are early returns rather
 * than a nested ternary chain, and so the screen component itself stays readable as its own
 * states (loading, grouped mitigations, evidence) accumulate rather than growing this too.
 */
function DecisionSection({
  autoDispatched,
  decided,
  canDecide,
  deciding,
  onApprove,
  onEdit,
  onReject,
}: DecisionSectionProps) {
  const { t } = useTranslation();

  if (autoDispatched) {
    return (
      <View style={styles.gapTop}>
        <MessageBanner message={t("recommendations.autoDispatchedNotice")} tone="danger" />
      </View>
    );
  }

  if (decided) {
    return (
      <AppText variant="caption" tone="secondary" style={styles.gapTop}>
        {t("recommendations.decisionBySomeone")}
      </AppText>
    );
  }

  if (canDecide) {
    return (
      <View style={styles.gapTop}>
        <AppButton
          title={deciding ? t("recommendations.deciding") : t("recommendations.approveButton")}
          loading={deciding}
          onPress={onApprove}
          style={styles.action}
        />
        <AppButton
          title={t("recommendations.editButton")}
          variant="secondary"
          onPress={onEdit}
          style={styles.action}
        />
        <AppButton
          title={t("recommendations.rejectButton")}
          variant="danger"
          onPress={onReject}
          style={styles.action}
        />
      </View>
    );
  }

  // A safety manager reads this screen but cannot decide on it. Said plainly, rather
  // than shown as three buttons that would each answer 403.
  return (
    <AppText variant="caption" tone="secondary" style={styles.gapTop}>
      {t("recommendations.readOnlyNotice")}
    </AppText>
  );
}

export default function RecommendationDetailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const route = useRoute<RouteProp<RecommendationsStackParamList, "RecommendationDetail">>();
  const { siteId, shiftId, recommendationId } = route.params;

  const recommendation = useAppSelector((state) =>
    state.recommendations.items.find((item) => item.id === recommendationId),
  );
  const decidingId = useAppSelector((state) => state.recommendations.decidingId);
  const user = useAppSelector((state) => state.auth.user);

  const navigation = useNavigation();

  /*
   * The catalogue, so the cited label can be resolved to a version (SCRUM-120). Loaded here
   * because a supervisor may reach this screen without ever opening the policy list, and an
   * unresolved label would silently render as plain text rather than as the link it should be.
   */
  const policyVersions = useAppSelector((state) => state.policy.versions);

  /*
   * The site roster, so `appliesTo` can name people rather than print UUIDs (SCRUM-118).
   *
   * `GET /workers` returns ACTIVE workers only, so a mitigation naming someone since offboarded
   * resolves to no name — the row falls back to the raw id rather than dropping the person, which
   * would understate who an action covers.
   */
  const workers = useAppSelector((state) => state.shifts.workers);
  const workerNameFor = useCallback(
    (workerId: string) =>
      workers.find((worker) => worker.id === workerId)?.displayName ?? t("shifts.unknownWorker"),
    [workers, t],
  );
  useEffect(() => {
    void dispatch(loadPolicyVersions({ siteId }));
  }, [dispatch, siteId]);

  /* Matched on the label, which is what a recommendation stores. Unique per site server-side. */
  const citedVersion = useMemo(
    () =>
      recommendation?.policyVersion
        ? (policyVersions.find(
            (version) => version.versionLabel === recommendation.policyVersion,
          ) ?? null)
        : null,
    [policyVersions, recommendation?.policyVersion],
  );

  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  /**
   * Only a supervisor or admin may decide; a safety manager reads the same screen (SCRUM-119).
   *
   * Checked here as well as server-side — not because the client is the authority, but because
   * offering a button that always 403s is a worse answer than saying plainly that this account
   * can read but not decide.
   */
  const canDecide = user?.role === "SUPERVISOR" || user?.role === "ADMIN";
  const deciding = decidingId === recommendationId;

  /** Mitigations grouped by topic, in a fixed order, with uncategorised ones last. */
  const grouped = useMemo(() => {
    if (!recommendation) return [];
    const source = recommendation.mitigations;
    const groups = CATEGORY_ORDER.map((category) => ({
      category,
      items: source.filter((m) => m.category === category),
    })).filter((group) => group.items.length > 0);

    // A plan drafted before SCRUM-119 has no categories at all. Showing those under an invented
    // heading would be a lie about the data, so they go in an unlabelled group.
    const uncategorised = source.filter((m) => m.category === null);
    return uncategorised.length > 0
      ? [...groups, { category: null as MitigationCategory | null, items: uncategorised }]
      : groups;
  }, [recommendation]);

  const submit = useCallback(
    async (input: Parameters<typeof decideRecommendation>[0]["input"]) => {
      const result = await dispatch(
        decideRecommendation({ siteId, shiftId, recommendationId, input }),
      );

      if (decideRecommendation.fulfilled.match(result)) {
        dispatch(showToast({ messageKey: "recommendations.decisionByYou", tone: "success" }));
        return;
      }

      /*
       * A 409 is not a retryable failure — someone genuinely decided first, and the useful thing
       * is to show them what was decided rather than let them try again. Reloading is what makes
       * the screen tell the truth; the Alert explains why it just changed under them.
       */
      const errorKey = result.payload?.errorKey ?? "errors.unknown";
      if (errorKey === "errors.conflict") {
        void dispatch(loadRecommendations({ siteId }));
        Alert.alert(t("recommendations.decisionFailedTitle"), t("recommendations.alreadyDecided"), [
          { text: t("common.close") },
        ]);
        return;
      }

      Alert.alert(t("recommendations.decisionFailedTitle"), t(errorKey), [
        { text: t("common.close") },
      ]);
    },
    [dispatch, recommendationId, shiftId, siteId, t],
  );

  const onApprove = useCallback(() => {
    Alert.alert(t("recommendations.approveTitle"), t("recommendations.approveBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("recommendations.approveConfirm"), onPress: () => void submit({ decision: "APPROVED" }) },
    ]);
  }, [submit, t]);

  /*
   * Gone from the list the instant a reload drops it, which is also when this screen is
   * unmounting — a null here is the ordinary way out, not an error state worth rendering.
   */
  if (!recommendation) return null;

  const approval = recommendation.approval;
  /*
   * SCRUM-440: a lightning-immediate or WBGT-max stop-work has no Approval at all -- it skipped
   * that step entirely -- so `approval !== null` alone would miss it, and this screen would
   * still offer Approve/Edit/Reject on a plan that already took effect. Treated as decided for
   * the same reason SUPERSEDED and a real decision both hide the buttons: there is nothing left
   * for a supervisor to do here.
   */
  const autoDispatched = recommendation.status === "AUTO_DISPATCHED";
  const decided = approval !== null || autoDispatched;

  return (
    <AppSafeView>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.card,
            cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
            { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
          ]}
        >
          <RecommendationStatusPill
            status={recommendation.status}
            decision={approval?.decision ?? null}
          />
          <AppText variant="caption" tone="secondary" style={styles.metaLine}>
            {t("recommendations.draftedAt", {
              time: formatDateTime(recommendation.createdAt, i18n.language),
            })}
          </AppText>
          {approval ? (
            <AppText variant="caption" tone="secondary">
              {t("recommendations.decidedAt", {
                time: formatDateTime(approval.decidedAt, i18n.language),
              })}
            </AppText>
          ) : null}
        </View>

        {/* ── Why, and on what ─────────────────────────────────────────────── */}
        {recommendation.rationale ? (
          <>
            <AppText variant="subtitle" style={styles.sectionTitle}>
              {t("recommendations.whyTitle")}
            </AppText>
            <AppText variant="body" style={styles.block}>
              {recommendation.rationale}
            </AppText>
          </>
        ) : null}

        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("recommendations.evidenceTitle")}
        </AppText>
        <View style={styles.detailRow}>
          <AppText variant="caption" tone="secondary">
            {t("recommendations.policyVersion")}
          </AppText>
          {/*
            FR-16: the supervisor must be able to see which rule set produced this. Saying
            "not recorded" is honest; omitting the row would imply there was nothing to show.

            Where the cited label resolves to a version we hold, it becomes a link (SCRUM-120) —
            that is what turns "recommendations cite version" from a string in a database into
            something a human can actually follow. Where it does not resolve — an older row, or a
            label from before the catalogue existed — it stays plain text rather than becoming a
            link that goes nowhere.
          */}
          {citedVersion ? (
            <TouchableOpacity
              accessibilityRole="link"
              accessibilityLabel={`${t("recommendations.policyVersion")}: ${citedVersion.versionLabel}`}
              onPress={() =>
                navigation
                  .getParent()
                  ?.navigate("ProfileTab", {
                    screen: "PolicyVersionDetail",
                    params: { versionId: citedVersion.id },
                  })
              }
            >
              <AppText variant="label" style={styles.citedVersion}>
                {citedVersion.versionLabel}
              </AppText>
            </TouchableOpacity>
          ) : (
            <AppText variant="label">
              {recommendation.policyVersion ?? t("recommendations.noPolicyVersion")}
            </AppText>
          )}
        </View>

        {/* ── The draft ────────────────────────────────────────────────────── */}
        <AppText variant="subtitle" style={[styles.sectionTitle, styles.gapTop]}>
          {decided ? t("recommendations.originalDraftTitle") : t("recommendations.actionsTitle")}
        </AppText>

        {grouped.map((group) => (
          <View
            key={group.category ?? "uncategorised"}
            style={[
              styles.card,
              cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
              { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
            ]}
          >
            {group.category ? (
              <AppText variant="label" tone="secondary" style={styles.groupTitle}>
                {t(`mitigationCategory.${group.category}`)}
              </AppText>
            ) : null}
            {group.items.map((mitigation, index) => (
              <MitigationRow
                key={`${mitigation.actionCode ?? "none"}-${index}`}
                mitigation={mitigation}
                workerNameFor={workerNameFor}
              />
            ))}
          </View>
        ))}

        {/* ── What was actually approved, when it differs ──────────────────── */}
        {approval?.decision === "EDITED" && approval.editedMitigations ? (
          <>
            <AppText variant="subtitle" style={[styles.sectionTitle, styles.gapTop]}>
              {t("recommendations.approvedPlanTitle")}
            </AppText>
            <View
              style={[
                styles.card,
                cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
              ]}
            >
              <AppText variant="caption" tone="warning" style={styles.groupTitle}>
                {t("recommendations.changedFromDraft")}
              </AppText>
              {approval.editedMitigations.map((mitigation, index) => (
                <MitigationRow
                  key={`edited-${index}`}
                  mitigation={mitigation}
                  workerNameFor={workerNameFor}
                />
              ))}
            </View>
          </>
        ) : null}

        {approval?.decision === "REJECTED" && approval.reason ? (
          <View style={styles.block}>
            <MessageBanner message={approval.reason} tone="danger" />
          </View>
        ) : null}

        {/* ── The decision ─────────────────────────────────────────────────── */}
        <DecisionSection
          autoDispatched={autoDispatched}
          decided={decided}
          canDecide={canDecide}
          deciding={deciding}
          onApprove={onApprove}
          onEdit={() => setEditing(true)}
          onReject={() => setRejecting(true)}
        />
      </ScrollView>

      <EditPlanSheet
        visible={editing}
        mitigations={recommendation.mitigations}
        saving={deciding}
        onCancel={() => setEditing(false)}
        onSend={(editedPlan: Mitigation[]) => {
          setEditing(false);
          void submit({ decision: "EDITED", editedPlan });
        }}
      />

      <RejectSheet
        visible={rejecting}
        saving={deciding}
        onCancel={() => setRejecting(false)}
        onReject={(reason) => {
          setRejecting(false);
          void submit({ decision: "REJECTED", reason });
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
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  metaLine: {
    marginTop: vs(8),
  },
  sectionTitle: {
    marginBottom: vs(8),
  },
  groupTitle: {
    marginBottom: vs(4),
  },
  citedVersion: {
    // Underlined so it reads as a link without relying on colour, which high contrast flattens.
    textDecorationLine: "underline",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: vs(8),
  },
  block: {
    marginBottom: vs(12),
  },
  gapTop: {
    marginTop: vs(12),
  },
  action: {
    marginTop: vs(8),
  },
});
