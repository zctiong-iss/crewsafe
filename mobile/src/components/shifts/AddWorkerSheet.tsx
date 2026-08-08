/**
 * Putting another worker on a shift that already exists (SCRUM-266).
 *
 * ── WHY IT IS A SHEET AND NOT A ROW OF NAMES ────────────────────────────────────────────
 * An assignment is a worker *and* what they will be doing. Adding someone with a blank task
 * and a guessed intensity would create a record a supervisor then has to go and correct, so
 * the same three fields the create form asks for are asked for here — once, before the worker
 * is added, rather than as a follow-up edit.
 *
 * ── WHY THE CANDIDATE LIST IS FILTERED, NOT VALIDATED ───────────────────────────────────
 * Only workers not already on this shift are offered. The server would refuse a duplicate
 * anyway — `guardAgainstDoubleBooking` catches it, since a shift's own range trivially
 * overlaps itself — but the error it produces talks about overlapping shifts, which is a
 * confusing thing to be told about the person visibly listed on the screen behind the sheet.
 *
 * It is a filter rather than a promise: a worker on a *different* shift at an overlapping time
 * is still offered and still refused, because this screen cannot see other shifts' crews. That
 * rejection is surfaced by the caller with the server's own wording.
 *
 * @author Justin Chua
 */
import { useEffect, useState, type FC } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInput from "@/components/inputs/AppTextInput";
import SegmentedControl from "@/components/inputs/SegmentedControl";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { intensityColor } from "@/helpers/intensityColor";
import { useTheme } from "@/theme/ThemeProvider";
import type { Intensity, SiteWorker } from "@/types/domain";

const INTENSITIES: Intensity[] = ["LIGHT", "MODERATE", "HEAVY"];

/** `@Size(max = 120)` on ShiftAssignmentCreateRequest.taskName. */
const MAX_TASK_LENGTH = 120;

/** 1–7, matching `@Min(1) @Max(7)` on the server. FR-07's acclimatisation period. */
const ACCLIMATISATION_MIN = 1;
const ACCLIMATISATION_MAX = 7;

interface AddWorkerSheetProps {
  visible: boolean;
  /** Already filtered to workers not on this shift — see the note above. */
  candidates: SiteWorker[];
  saving: boolean;
  onCancel: () => void;
  onAdd: (values: {
    workerId: string;
    taskName?: string;
    intensity: Intensity;
    acclimatisationDay?: number;
  }) => void;
}

const AddWorkerSheet: FC<AddWorkerSheetProps> = ({
  visible,
  candidates,
  saving,
  onCancel,
  onAdd,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [workerId, setWorkerId] = useState<string | null>(null);
  const [taskName, setTaskName] = useState("");
  // MODERATE rather than blank, as in the create form: it is the middle of the three and the
  // most common, and an unset intensity would block a save on a field the supervisor may not
  // have realised was theirs to answer.
  const [intensity, setIntensity] = useState<Intensity>("MODERATE");
  const [acclimatisation, setAcclimatisation] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* Cleared on every open — the component stays mounted, so the second worker added would
     otherwise arrive pre-filled with the first one's task. */
  useEffect(() => {
    if (!visible) return;
    setWorkerId(null);
    setTaskName("");
    setIntensity("MODERATE");
    setAcclimatisation("");
    setError(null);
  }, [visible]);

  const submit = () => {
    if (!workerId) {
      setError(t("shifts.validation.workerRequired"));
      return;
    }

    const trimmed = acclimatisation.trim();
    let day: number | undefined;
    if (trimmed !== "") {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < ACCLIMATISATION_MIN || parsed > ACCLIMATISATION_MAX) {
        setError(t("shifts.validation.acclimatisationRange"));
        return;
      }
      day = parsed;
    }

    onAdd({
      workerId,
      // Omitted rather than sent empty: the contract makes taskName optional, and "" would be
      // stored as an empty task rather than no task.
      taskName: taskName.trim() === "" ? undefined : taskName.trim(),
      intensity,
      acclimatisationDay: day,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="title">{t("shifts.addWorkerTitle")}</AppText>

          {candidates.length === 0 ? (
            /* Everyone at the site is already on this shift. Stated rather than shown as an
               empty list, which reads as a screen that failed to load. */
            <AppText variant="body" tone="secondary">
              {t("shifts.addWorkerNoneLeft")}
            </AppText>
          ) : (
            candidates.map((worker) => (
              <RadioWithTitle
                key={worker.id}
                title={worker.displayName}
                selected={workerId === worker.id}
                onPress={() => {
                  setWorkerId(worker.id);
                  setError(null);
                }}
              />
            ))
          )}

          {candidates.length > 0 ? (
            <>
              <AppTextInput
                label={t("shifts.task")}
                value={taskName}
                onChangeText={setTaskName}
                placeholder={t("shifts.noTask")}
                maxLength={MAX_TASK_LENGTH}
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
                maxLength={1}
                errorMessage={error ?? undefined}
              />

              <AppButton
                title={saving ? t("shifts.saving") : t("shifts.addWorkerConfirm")}
                loading={saving}
                onPress={submit}
                style={styles.action}
              />
            </>
          ) : null}

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

export default AddWorkerSheet;

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  content: {
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(24),
    gap: vs(12),
  },
  action: {
    marginTop: vs(8),
  },
});
