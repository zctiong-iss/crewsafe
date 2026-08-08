/**
 * Correcting the times an existing shift runs between (SCRUM-266).
 *
 * ── WHY THE WINDOW IS EDITABLE AT ALL ───────────────────────────────────────────────────
 * A shift planned for the wrong hours previously had one remedy: delete it and rebuild it,
 * losing every assignment on it. `PATCH /sites/{id}/shifts/{id}` has existed since
 * SCRUM-159/160-fix; nothing in the app called it.
 *
 * ── WHAT MOVING THE WINDOW ACTUALLY MOVES ───────────────────────────────────────────────
 * Everyone on the shift. Unlike an assignment edit, which touches one worker, this changes
 * when the whole crew is expected on site — so the running-shift confirmation names the crew
 * size rather than a worker. Shortening a running shift is the case worth pausing over: an
 * `endsAt` moved into the past ends the shift, and the server will then refuse every further
 * edit to it.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────────────────
 * `status`. It is server-controlled, and a client that could set it could declare its own
 * shift closed — which is exactly the state the server now refuses to edit.
 *
 * @author Justin Chua
 */
import { useEffect, useState, type FC } from "react";
import { Alert, Modal, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppDateTimeField from "@/components/inputs/AppDateTimeField";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

interface EditShiftWindowSheetProps {
  visible: boolean;
  startsAt: string;
  endsAt: string;
  /** True while the shift is already running — drives the confirmation. */
  shiftIsRunning: boolean;
  /** Named in the confirmation, because moving the window moves all of them. */
  crewSize: number;
  saving: boolean;
  onCancel: () => void;
  onSave: (values: { startsAt: string; endsAt: string }) => void;
}

const EditShiftWindowSheet: FC<EditShiftWindowSheetProps> = ({
  visible,
  startsAt,
  endsAt,
  shiftIsRunning,
  crewSize,
  saving,
  onCancel,
  onSave,
}) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Reset from the shift every time the sheet opens rather than once on mount — the component
   * stays mounted between openings, so a supervisor who cancels and reopens would otherwise be
   * editing whatever they had abandoned rather than what the shift actually says.
   */
  useEffect(() => {
    if (!visible) return;
    setStart(new Date(startsAt));
    setEnd(new Date(endsAt));
    setError(null);
  }, [visible, startsAt, endsAt]);

  const submit = () => {
    if (!start || !end) {
      setError(t("shifts.validation.startRequired"));
      return;
    }
    // Strictly after, matching `!endsAt.isAfter(startsAt)` in ShiftService — equal timestamps
    // are a 400 server-side, so they must fail here rather than after a round trip.
    if (end.getTime() <= start.getTime()) {
      setError(t("shifts.validation.endNotAfterStart"));
      return;
    }

    // ISO 8601 UTC per §12.2: the site's local time picked above is converted once, here.
    const values = { startsAt: start.toISOString(), endsAt: end.toISOString() };

    if (!shiftIsRunning) {
      onSave(values);
      return;
    }

    // `crew`, not `count`: `count` makes i18next resolve plural suffixes, and these strings
    // are written once per locale rather than in one/other pairs.
    Alert.alert(t("shifts.editWindowActiveTitle"), t("shifts.editWindowActiveBody", { crew: crewSize }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("shifts.editActiveConfirm"), onPress: () => onSave(values) },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="title">{t("shifts.editWindowTitle")}</AppText>
          <AppText variant="body" tone="secondary" style={styles.hint}>
            {t("shifts.editWindowHint")}
          </AppText>

          <AppDateTimeField
            label={t("shifts.form.startsAt")}
            placeholder={t("shifts.form.pickDateTime")}
            value={start}
            onChange={(next) => {
              setStart(next);
              setError(null);
            }}
            locale={i18n.language}
          />

          <AppDateTimeField
            label={t("shifts.form.endsAt")}
            placeholder={t("shifts.form.pickDateTime")}
            value={end}
            onChange={(next) => {
              setEnd(next);
              setError(null);
            }}
            locale={i18n.language}
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

export default EditShiftWindowSheet;

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  content: {
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(24),
    gap: vs(12),
  },
  hint: {
    marginBottom: vs(4),
  },
  action: {
    marginTop: vs(8),
  },
});
