/**
 * Calling a shift off, with the reason that makes it reviewable (SCRUM-442).
 *
 * ── WHY THE REASON IS REQUIRED ──────────────────────────────────────────────────────────
 * The server refuses a reasonless cancel with a 400 (`@NotBlank`, max 500) and writes what it
 * is given to the audit trail as `SHIFT_CANCELLED`. So this is not a form field, it is the
 * record of why a crew was stood down — the only place that answer survives. This checks first
 * so a supervisor is told before a round trip rather than after one, exactly as `RejectSheet`
 * does for a rejected plan.
 *
 * ── WHY CANCEL AND CLOSE ARE NOT THE SAME BUTTON ────────────────────────────────────────
 * A cancelled shift did not happen; a closed one ran and is finished. `ShiftService` draws the
 * same line — cancel exists so the shift "stays visible as this didn't happen", unlike delete,
 * "which erases them". The copy here has to carry that, because on this screen a supervisor is
 * choosing between three permanent and quite different things.
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
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

/** Mirrors the server's `@Size(max = 500)`, so it never has to refuse on length. */
const REASON_MAX_LENGTH = 500;

interface CancelShiftSheetProps {
  visible: boolean;
  saving: boolean;
  onDismiss: () => void;
  onConfirm: (reason: string) => void;
}

const CancelShiftSheet: FC<CancelShiftSheetProps> = ({ visible, saving, onDismiss, onConfirm }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* Cleared on every open. The component stays mounted, and a second cancellation arriving
     pre-filled with the reason for the first would be recorded against the wrong shift. */
  useEffect(() => {
    if (!visible) return;
    setReason("");
    setError(null);
  }, [visible]);

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError(t("shifts.cancelReasonRequired"));
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onDismiss}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="title">{t("shifts.cancelTitle")}</AppText>
          {/* Says what cancelling means and that it cannot be undone. A supervisor picking
              between Cancel, Close and Delete needs the difference stated, not implied. */}
          <AppText variant="body" tone="secondary">
            {t("shifts.cancelBody")}
          </AppText>

          <AppTextInput
            label={t("shifts.cancelReasonLabel")}
            value={reason}
            onChangeText={(next) => {
              setReason(next);
              setError(null);
            }}
            multiline
            maxLength={REASON_MAX_LENGTH}
            errorMessage={error ?? undefined}
          />

          <AppButton
            title={saving ? t("shifts.cancelling") : t("shifts.cancelConfirm")}
            variant="danger"
            loading={saving}
            onPress={submit}
            style={styles.action}
          />
          <AppButton
            title={t("common.cancel")}
            variant="secondary"
            onPress={onDismiss}
            style={styles.action}
          />
        </ScrollView>
      </View>
    </Modal>
  );
};

export default CancelShiftSheet;

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
