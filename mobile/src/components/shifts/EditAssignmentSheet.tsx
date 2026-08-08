/**
 * Correcting one worker's details on an existing shift (SCRUM-266).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────
 * Until now a supervisor who mistyped an acclimatisation day had one remedy: delete the whole
 * shift — destroying every other assignment on it — and rebuild it. The backend has accepted
 * `PATCH …/assignments/{id}` since SCRUM-159/160-fix; nothing in the app ever called it.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────────────────
 * The worker. Moving an assignment to a different person is a remove and an add, not a
 * correction, and the audit trail says `SHIFT_ASSIGNMENT_UPDATED` — the server's
 * `ShiftAssignment.correct` does not accept a worker id either. Editing the name here would
 * quietly reassign work through an endpoint that claims to be fixing a typo.
 *
 * ── THE ACTIVE CONFIRMATION IS NOT CEREMONY ─────────────────────────────────────────────
 * Changing intensity on a running shift changes the heat obligations the worker is already
 * under, and the dispatch inbox may already hold actions computed from the old value. The
 * supervisor is told that before they commit, not after. An ended shift cannot be edited at
 * all — the server refuses too, so this is a courtesy rather than the enforcement.
 *
 * @author Justin Chua
 */
import { useEffect, useState, type FC } from "react";
import { Alert, Modal, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInput from "@/components/inputs/AppTextInput";
import SegmentedControl from "@/components/inputs/SegmentedControl";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { intensityColor } from "@/helpers/intensityColor";
import { useTheme } from "@/theme/ThemeProvider";
import type { Intensity, ShiftAssignment } from "@/types/domain";

const INTENSITIES: Intensity[] = ["LIGHT", "MODERATE", "HEAVY"];

/** 1–7, matching `@Min(1) @Max(7)` on the server. FR-07's acclimatisation period. */
const ACCLIMATISATION_MIN = 1;
const ACCLIMATISATION_MAX = 7;

interface EditAssignmentSheetProps {
  visible: boolean;
  assignment: ShiftAssignment | null;
  workerName: string;
  /** True while a stop-work-relevant shift is running — drives the confirmation. */
  shiftIsRunning: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (values: {
    taskName?: string;
    intensity: Intensity;
    acclimatisationDay?: number;
  }) => void;
}

const EditAssignmentSheet: FC<EditAssignmentSheetProps> = ({
  visible,
  assignment,
  workerName,
  shiftIsRunning,
  saving,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [taskName, setTaskName] = useState("");
  const [intensity, setIntensity] = useState<Intensity>("MODERATE");
  const [acclimatisation, setAcclimatisation] = useState("");
  const [error, setError] = useState<string | null>(null);

  /*
   * Reset from the assignment every time the sheet opens, not once on mount. The component
   * stays mounted between openings, so without this the second worker edited would inherit
   * the first one's values — and a supervisor correcting two people in a row would not
   * necessarily notice before saving.
   */
  useEffect(() => {
    if (!visible || !assignment) return;
    setTaskName(assignment.taskName ?? "");
    setIntensity(assignment.intensity);
    setAcclimatisation(
      assignment.acclimatisationDay === null ? "" : String(assignment.acclimatisationDay),
    );
    setError(null);
  }, [visible, assignment]);

  /** Mirrors the server's `@Min(1) @Max(7)` and nullability, so a save is not a round trip to find out. */
  const parseAcclimatisation = (): { ok: true; value?: number } | { ok: false } => {
    const trimmed = acclimatisation.trim();
    if (trimmed === "") return { ok: true, value: undefined };

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < ACCLIMATISATION_MIN || parsed > ACCLIMATISATION_MAX) {
      return { ok: false };
    }
    return { ok: true, value: parsed };
  };

  const submit = () => {
    const day = parseAcclimatisation();
    if (!day.ok) {
      setError(t("shifts.validation.acclimatisationRange"));
      return;
    }

    const values = {
      // Empty means "no task", which is a legitimate value the server models as null — not
      // the same as leaving the field alone.
      taskName: taskName.trim() === "" ? undefined : taskName.trim(),
      intensity,
      acclimatisationDay: day.value,
    };

    if (!shiftIsRunning) {
      onSave(values);
      return;
    }

    Alert.alert(t("shifts.editActiveTitle"), t("shifts.editActiveBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("shifts.editActiveConfirm"), onPress: () => onSave(values) },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="title">{t("shifts.editTitle")}</AppText>
          <AppText variant="body" tone="secondary" style={styles.worker}>
            {workerName}
          </AppText>

          <AppTextInput
            label={t("shifts.task")}
            value={taskName}
            onChangeText={setTaskName}
            placeholder={t("shifts.noTask")}
          />

          <SegmentedControl
            label={t("shifts.intensity")}
            options={INTENSITIES.map((value) => ({ value, label: t(`intensity.${value}`) }))}
            value={intensity}
            onChange={setIntensity}
            selectedColorFor={(value) => intensityColor(theme.colors, value)}
          />

          <AppTextInput
            label={t("shifts.acclimatisationLabel")}
            value={acclimatisation}
            onChangeText={(next) => {
              setAcclimatisation(next);
              setError(null);
            }}
            keyboardType="number-pad"
            errorMessage={error ?? undefined}
          />

          <AppButton
            title={saving ? t("shifts.saving") : t("common.save")}
            loading={saving}
            onPress={submit}
            style={styles.action}
          />
          <AppButton
            title={t("common.cancel")}
            variant="secondary"
            onPress={onCancel}
            style={styles.action}
          />
        </ScrollView>
      </View>
    </Modal>
  );
};

export default EditAssignmentSheet;

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  content: {
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(24),
    gap: vs(12),
  },
  worker: {
    marginBottom: vs(4),
  },
  action: {
    marginTop: vs(8),
  },
});
