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
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import ShiftStatusPill from "@/components/shifts/ShiftStatusPill";
import EditAssignmentSheet from "@/components/shifts/EditAssignmentSheet";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { editAssignment, removeShift } from "@/store/reducers/shiftsSlice";
import { showToast } from "@/store/reducers/uiSlice";
import { formatDateTime } from "@/helpers/dateTime";
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

  const [editing, setEditing] = useState<ShiftAssignment | null>(null);

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
        </View>

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
                <AppText variant="label" style={styles.detailValue}>
                  {t(`intensity.${assignment.intensity}`)}
                </AppText>
              </View>

              {editability.editable ? (
                <AppButton
                  title={t("shifts.editAssignment")}
                  variant="secondary"
                  loading={savingAssignmentId === assignment.id}
                  onPress={() => setEditing(assignment)}
                  style={styles.editButton}
                />
              ) : null}

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
            </View>
          ))
        )}

        {/* Stated rather than left to be inferred from a missing button. A supervisor who
            cannot find the edit control should be told the shift is over, not left hunting. */}
        {!editability.editable ? (
          <AppText variant="caption" tone="secondary" style={styles.block}>
            {t("shifts.notEditable")}
          </AppText>
        ) : null}

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
    padding: s(8),
    alignSelf: "flex-start",
  },
  editButton: {
    marginTop: vs(10),
  },
  block: {
    marginTop: vs(12),
  },
});
