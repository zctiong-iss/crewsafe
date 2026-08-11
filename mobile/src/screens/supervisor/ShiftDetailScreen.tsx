/**
 * One shift and its crew (SCRUM-161).
 *
 * ── WHY DELETE IS HERE ──────────────────────────────────────────────────────────────────
 * `DELETE /shifts/{id}` exists because of this story. The SCRUM-159/160 fix added PATCH and
 * DELETE after building the create form revealed that shifts were create-and-read-only,
 * "no way to correct a mistaken entry or remove one". A shift planned against the wrong
 * site or the wrong day has to be removable, so the removal lives next to the thing being
 * removed.
 *
 * It is confirmed, unlike acknowledging an action. The distinction is not consistency for
 * its own sake: acknowledging is reversible in every way that matters and is done in gloves
 * on a hot site, whereas this destroys a shift and every assignment on it with no undo.
 *
 * @author Justin Chua
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import ShiftStatusPill from "@/components/shifts/ShiftStatusPill";
import CrewWellbeingRow from "@/components/wellbeing/CrewWellbeingRow";
import EditAssignmentSheet from "@/components/shifts/EditAssignmentSheet";
import EditShiftWindowSheet from "@/components/shifts/EditShiftWindowSheet";
import AddWorkerSheet from "@/components/shifts/AddWorkerSheet";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addWorkerToShift,
  editAssignment,
  editShiftWindow,
  removeShift,
  removeWorkerFromShift,
} from "@/store/reducers/shiftsSlice";
import { showToast } from "@/store/reducers/uiSlice";
import { loadCrewWellbeing } from "@/store/reducers/wellbeingSlice";
import { formatDateTime } from "@/helpers/dateTime";
import { intensityColor } from "@/helpers/intensityColor";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { ShiftAssignment } from "@/types/domain";
import type { ShiftsStackParamList } from "@/navigation/types";

export default function ShiftDetailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<ShiftsStackParamList>>();
  const route = useRoute<RouteProp<ShiftsStackParamList, "ShiftDetail">>();
  const { siteId, shiftId } = route.params;

  const shift = useAppSelector((state) =>
    state.shifts.shifts.find((item) => item.id === shiftId),
  );
  const workers = useAppSelector((state) => state.shifts.workers);
  const deletingId = useAppSelector((state) => state.shifts.deletingId);
  const savingAssignmentId = useAppSelector((state) => state.shifts.savingAssignmentId);
  const savingWindow = useAppSelector((state) => state.shifts.savingWindow);
  const staffingId = useAppSelector((state) => state.shifts.staffingId);

  /* US-11: how the crew is coping, loaded alongside the shift itself. */
  const crew = useAppSelector((state) => state.wellbeing.crew);

  useEffect(() => {
    void dispatch(loadCrewWellbeing({ siteId, shiftId }));
  }, [dispatch, siteId, shiftId]);

  const [editing, setEditing] = useState<ShiftAssignment | null>(null);
  const [editingWindow, setEditingWindow] = useState(false);
  const [addingWorker, setAddingWorker] = useState(false);

  /**
   * Whether this shift may still be corrected (SCRUM-266).
   *
   * `CLOSED` and a past `endsAt` are both checked because they are not the same fact: nothing
   * moves a shift to `CLOSED` on a timer, so status alone would leave yesterday's shifts
   * looking editable. The server refuses either way — this only decides what to offer.
   */
  const editability = useMemo(() => {
    if (!shift) return { editable: false, running: false };
    const ended = shift.status === "CLOSED" || new Date(shift.endsAt).getTime() <= Date.now();
    const running =
      !ended && new Date(shift.startsAt).getTime() <= Date.now();
    return { editable: !ended, running };
  }, [shift]);

  /** True while the confirmation dialog is on screen. See `onDelete`. */
  const confirmOpen = useRef(false);

  /**
   * Assignments carry only `workerId`. `GET /workers` returns ACTIVE workers only, so a
   * shift referencing someone since offboarded resolves to no name — the contract says
   * existing assignments are left untouched when a worker is deactivated. Showing the raw
   * UUID would be useless to a supervisor; saying so plainly is not.
   */
  const workerNameFor = useCallback(
    (workerId: string) =>
      workers.find((worker) => worker.id === workerId)?.displayName ??
      t("shifts.unknownWorker"),
    [workers, t],
  );

  /**
   * Workers at this site who are not already on this shift (SCRUM-266).
   *
   * `workers` is the site roster, `shift.assignments` is who is already on. Offering someone
   * twice would produce a server rejection phrased in terms of overlapping shifts, about a
   * person visibly listed on the screen behind the sheet.
   */
  const candidates = useMemo(() => {
    if (!shift) return [];
    const taken = new Set(shift.assignments.map((assignment) => assignment.workerId));
    return workers.filter((worker) => !taken.has(worker.id));
  }, [shift, workers]);

  /**
   * Reports a failed crew or window change (SCRUM-266).
   *
   * An Alert rather than a banner, for the reason the delete flow gives: the supervisor has
   * just committed a deliberate change and the answer to "did that work?" must not be a
   * message that can sit below the fold on a shift with a large crew.
   */
  const reportFailure = useCallback(
    (titleKey: string, errorKey: string | undefined) => {
      Alert.alert(t(titleKey), t(errorKey ?? "errors.unknown"), [{ text: t("common.close") }]);
    },
    [t],
  );

  const onRemoveWorker = useCallback(
    (assignment: ShiftAssignment) => {
      /*
       * Confirmed, unlike an assignment edit. Taking a worker off a shift is not a correction
       * that can be corrected back in the same place — once removed they are gone from this
       * screen, and putting them back means going through the add flow and re-entering the
       * task and acclimatisation day that were just discarded.
       */
      Alert.alert(
        t("shifts.removeWorkerTitle"),
        t("shifts.removeWorkerBody", { name: workerNameFor(assignment.workerId) }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("shifts.removeWorkerConfirm"),
            style: "destructive",
            onPress: async () => {
              const result = await dispatch(
                removeWorkerFromShift({ siteId, shiftId, assignmentId: assignment.id }),
              );
              if (removeWorkerFromShift.rejected.match(result)) {
                reportFailure("shifts.removeWorkerFailedTitle", result.payload?.errorKey);
              }
            },
          },
        ],
      );
    },
    [dispatch, reportFailure, shiftId, siteId, t, workerNameFor],
  );

  const onDelete = useCallback(() => {
    /*
     * The button disables itself once `deletingId` is set — but that only happens after the
     * dialog is confirmed. Between the first tap and the dialog appearing the button is
     * still live, so two quick taps stack two Alerts. The thunk's `condition` guard already
     * stops the second confirmation from firing a second DELETE; this stops the second
     * dialog from ever appearing, which is the difference between "safe" and "not
     * confusing".
     *
     * A ref, not state: it must take effect within the same tick as the tap, and a
     * re-render is too late.
     */
    if (confirmOpen.current) return;
    confirmOpen.current = true;

    const close = () => {
      confirmOpen.current = false;
    };

    Alert.alert(t("shifts.deleteTitle"), t("shifts.deleteBody"), [
      { text: t("common.cancel"), style: "cancel", onPress: close },
      {
        text: t("shifts.deleteConfirm"),
        style: "destructive",
        onPress: async () => {
          close();
          const result = await dispatch(removeShift({ siteId, shiftId }));

          if (removeShift.fulfilled.match(result)) {
            /*
             * Confirm it, because the outcome is otherwise invisible.
             *
             * Success pops back to a list where the shift is simply absent — which reads
             * identically to the screen having closed without doing anything. The toast is
             * dispatched before navigating so it outlives this screen; it is rendered at
             * the app root for exactly that reason.
             */
            dispatch(showToast({ messageKey: "shifts.deletedToast", tone: "success" }));
            navigation.goBack();
            return;
          }

          /*
           * Failure gets an Alert, not a banner.
           *
           * The supervisor is mid-way through a deliberate destructive flow they entered
           * through an Alert, and the answer to "did that work?" must not be a message that
           * can sit below the fold on a shift with a large crew. The screen also stays put:
           * popping back would leave them on a list still showing the shift with no
           * explanation.
           */
          Alert.alert(
            t("shifts.deleteFailedTitle"),
            t(result.payload?.errorKey ?? "errors.unknown"),
            [{ text: t("common.close") }],
          );
        },
      },
    ]);
  }, [dispatch, navigation, shiftId, siteId, t]);

  /*
   * The shift is read from the list already in the store rather than re-fetched.
   *
   * It is gone from that list the instant a delete succeeds, which is exactly when this
   * screen is unmounting — so a null here is the normal way out, not an error worth an
   * error screen.
   */
  if (!shift) return null;

  const deleting = deletingId === shiftId;

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
          <ShiftStatusPill status={shift.status} />
          <AppText variant="subtitle" style={styles.window}>
            {t("shifts.window", {
              start: formatDateTime(shift.startsAt, i18n.language),
              end: formatDateTime(shift.endsAt, i18n.language),
            })}
          </AppText>

          {editability.editable ? (
            <AppButton
              title={t("shifts.editWindow")}
              variant="secondary"
              loading={savingWindow}
              onPress={() => setEditingWindow(true)}
              style={styles.editButton}
            />
          ) : null}
        </View>

        {/*
          US-11: how the crew is coping, above the assignment cards.

          Above, not below, because it is the time-sensitive half. Who is on the shift changes
          rarely; whether somebody has drunk water in the last two hours changes constantly, and
          is the reason a supervisor opens this screen mid-shift at all.

          Rendered from the shift's own roster rather than from the wellbeing response, so a
          worker who has logged nothing still gets a row. That absent row is the one worth acting
          on, and driving the list off the response would hide exactly it.
        */}
        {shift.assignments.length > 0 ? (
          <View
            style={[
              styles.card,
              cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
              { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
            ]}
          >
            <AppText variant="subtitle">{t("wellbeing.crewTitle")}</AppText>
            {shift.assignments.map((assignment) => (
              <CrewWellbeingRow
                key={`wellbeing-${assignment.id}`}
                workerName={workerNameFor(assignment.workerId)}
                row={crew.find((row) => row.workerId === assignment.workerId) ?? null}
                locale={i18n.language}
              />
            ))}
          </View>
        ) : null}

        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("shifts.assignments")}
        </AppText>

        {shift.assignments.length === 0 ? (
          // Not an error: the contract allows a shift to be created empty and staffed later.
          <AppText variant="body" tone="secondary">
            {t("shifts.unstaffed")}
          </AppText>
        ) : (
          shift.assignments.map((assignment) => (
            <View
              key={assignment.id}
              style={[
                styles.card,
                cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
              ]}
            >
              <AppText variant="body">{workerNameFor(assignment.workerId)}</AppText>

              <View style={styles.detailRow}>
                <AppText variant="caption" tone="secondary" style={styles.detailLabel}>
                  {t("shifts.task")}
                </AppText>
                <AppText variant="label" style={styles.detailValue}>
                  {assignment.taskName ?? t("shifts.noTask")}
                </AppText>
              </View>

              <View style={styles.detailRow}>
                <AppText variant="caption" tone="secondary" style={styles.detailLabel}>
                  {t("shifts.intensity")}
                </AppText>
                {/* Coloured on the same green → amber → red ramp as the picker that set it, so
                    the card and the sheet agree at a glance. The word is still there: colour
                    is never the only thing carrying the meaning. */}
                <AppText
                  variant="label"
                  style={[
                    styles.detailValue,
                    { color: intensityColor(theme.colors, assignment.intensity) },
                  ]}
                >
                  {t(`intensity.${assignment.intensity}`)}
                </AppText>
              </View>

              {/*
                Above the buttons, not below them.

                It is a property of the assignment, like the two rows over it — reading it after
                the controls meant the card said what you could do to the worker before it had
                finished saying who they were. Centred because it is the only element on its own
                line; left-aligned it looked like a fourth, unlabelled detail row.
              */}
              {assignment.acclimatisationDay !== null ? (
                <View
                  style={[
                    styles.acclimatisation,
                    {
                      borderColor: theme.colors.warning,
                      borderWidth: theme.metrics.borderWidth,
                      borderRadius: theme.metrics.radius / 2,
                    },
                  ]}
                >
                  <AppText variant="caption" tone="warning">
                    {t("shifts.acclimatisation", { day: assignment.acclimatisationDay })}
                  </AppText>
                </View>
              ) : null}

              {editability.editable ? (
                <>
                  <AppButton
                    title={t("shifts.editAssignment")}
                    variant="secondary"
                    loading={savingAssignmentId === assignment.id}
                    onPress={() => setEditing(assignment)}
                    style={styles.editButton}
                  />
                  <AppButton
                    title={t("shifts.removeWorker")}
                    variant="secondary"
                    loading={staffingId === assignment.id}
                    onPress={() => onRemoveWorker(assignment)}
                    style={styles.editButton}
                  />
                </>
              ) : null}
            </View>
          ))
        )}

        {/* Offered even on an unstaffed shift — that is exactly the case the contract has in
            mind when it allows a shift to be created empty and staffed later. */}
        {editability.editable ? (
          <AppButton
            title={t("shifts.addWorker")}
            variant="secondary"
            loading={staffingId === "add"}
            onPress={() => setAddingWorker(true)}
          />
        ) : null}

        {/* Stated rather than left to be inferred from a missing button. A supervisor who
            cannot find the edit control should be told the shift is over, not left hunting. */}
        {!editability.editable ? (
          <AppText variant="caption" tone="secondary" style={styles.block}>
            {t("shifts.notEditable")}
          </AppText>
        ) : null}

        {/*
          The in-context way into US-09: a supervisor looking at a shift can reach the plans
          drafted for it without hunting for the tab.

          It opens the Plans tab rather than a shift-filtered list. The recommendation endpoint is
          shift-scoped, so filtering is possible — but the list is short, it is already grouped by
          shift window, and a second entry point with its own filtered state is more moving parts
          than the ticket needs. Worth revisiting if a site ever runs enough concurrent shifts for
          the unfiltered list to be hard to scan.
        */}
        <AppButton
          title={t("shifts.viewRecommendations")}
          variant="secondary"
          onPress={() => navigation.getParent()?.navigate("RecommendationsTab")}
          style={styles.block}
        />

        <AppButton
          title={deleting ? t("shifts.deleting") : t("shifts.deleteButton")}
          variant="danger"
          loading={deleting}
          onPress={onDelete}
          style={styles.block}
        />
      </ScrollView>

      <EditAssignmentSheet
        visible={editing !== null}
        assignment={editing}
        workerName={editing ? workerNameFor(editing.workerId) : ""}
        shiftIsRunning={editability.running}
        saving={savingAssignmentId !== null}
        onCancel={() => setEditing(null)}
        onSave={(values) => {
          if (!editing) return;
          void dispatch(
            editAssignment({ siteId, shiftId, assignmentId: editing.id, ...values }),
          );
          setEditing(null);
        }}
      />

      <EditShiftWindowSheet
        visible={editingWindow}
        startsAt={shift.startsAt}
        endsAt={shift.endsAt}
        shiftIsRunning={editability.running}
        crewSize={shift.assignments.length}
        saving={savingWindow}
        onCancel={() => setEditingWindow(false)}
        onSave={(values) => {
          setEditingWindow(false);
          void (async () => {
            const result = await dispatch(editShiftWindow({ siteId, shiftId, ...values }));
            if (editShiftWindow.rejected.match(result)) {
              reportFailure("shifts.editWindowFailedTitle", result.payload?.errorKey);
            }
          })();
        }}
      />

      <AddWorkerSheet
        visible={addingWorker}
        candidates={candidates}
        saving={staffingId === "add"}
        onCancel={() => setAddingWorker(false)}
        onAdd={(assignment) => {
          setAddingWorker(false);
          void (async () => {
            const result = await dispatch(addWorkerToShift({ siteId, shiftId, assignment }));
            if (addWorkerToShift.rejected.match(result)) {
              reportFailure("shifts.addWorkerFailedTitle", result.payload?.errorKey);
            }
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
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  window: {
    marginTop: vs(8),
  },
  sectionTitle: {
    marginBottom: vs(8),
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginTop: vs(8),
  },
  detailLabel: {
    marginEnd: s(12),
  },
  detailValue: {
    // Wraps inside the card rather than running past its right edge — task names are free
    // text up to 120 characters.
    flexShrink: 1,
    textAlign: "right",
  },
  acclimatisation: {
    marginTop: vs(10),
    marginBottom: vs(4),
    padding: s(8),
    // Centred, and sized to its text rather than stretched: a full-width amber box would read
    // as a banner about the whole card instead of a note about one worker.
    alignSelf: "center",
  },
  editButton: {
    marginTop: vs(10),
  },
  block: {
    marginTop: vs(12),
  },
});
