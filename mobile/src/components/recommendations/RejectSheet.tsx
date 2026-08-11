/**
 * Rejecting a drafted plan, with the reason that makes it reviewable (SCRUM-119 / US-09).
 *
 * The reason is required, and the requirement is not bureaucratic. A rejection with no reason is
 * indistinguishable from a plan nobody looked at — and the point of putting a human in this loop
 * is that their judgement is recorded, not merely exercised. The server refuses a reasonless
 * rejection with a 400; this checks first so the supervisor is told before a round trip rather
 * than after one.
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

interface RejectSheetProps {
  visible: boolean;
  saving: boolean;
  onCancel: () => void;
  onReject: (reason: string) => void;
}

const RejectSheet: FC<RejectSheetProps> = ({ visible, saving, onCancel, onReject }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* Cleared on every open: the component stays mounted, and a second rejection arriving
     pre-filled with the reason for the first would be recorded against the wrong plan. */
  useEffect(() => {
    if (!visible) return;
    setReason("");
    setError(null);
  }, [visible]);

  const submit = () => {
    if (!reason.trim()) {
      setError(t("recommendations.rejectReasonRequired"));
      return;
    }
    onReject(reason.trim());
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="title">{t("recommendations.rejectTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("recommendations.rejectBody")}
          </AppText>

          <AppTextInput
            label={t("recommendations.rejectPlaceholder")}
            value={reason}
            onChangeText={(next) => {
              setReason(next);
              setError(null);
            }}
            multiline
            errorMessage={error ?? undefined}
          />

          <AppButton
            title={saving ? t("recommendations.deciding") : t("recommendations.rejectConfirm")}
            variant="danger"
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

export default RejectSheet;

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
