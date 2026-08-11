/**
 * A worker telling their supervisor they are struggling (US-11).
 *
 * ── CHIPS FIRST, WORDS OPTIONAL ─────────────────────────────────────────────────────────
 * The symptom chips carry the meaning that survives translation: a worker taps DIZZINESS in
 * Tamil and their supervisor reads "Dizzy" in English, because both are rendering the same enum
 * through `symptoms.*`. The note is the worker's own words in their own language, and the app
 * shows it as written rather than pretending it can translate it.
 *
 * The note stays optional for a reason that matters more than convenience: a worker must never
 * be unable to report that they are unwell because they cannot write in a language their
 * supervisor reads.
 *
 * ── THE VOCABULARY IS BORROWED, NOT INVENTED ────────────────────────────────────────────
 * `SymptomFlag` is the same enum the pre-shift readiness check uses. Reused rather than
 * duplicated so the same dizziness reported in two places is the same value in both, and so
 * these strings get one translation review rather than two.
 *
 * @author Justin Chua
 */
import { useEffect, useState, type FC } from "react";
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInput from "@/components/inputs/AppTextInput";
import MessageBanner from "@/components/feedback/MessageBanner";
import { sharedPaddingHorizontal } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { SymptomFlag } from "@/types/domain";

/**
 * `NONE` is deliberately absent.
 *
 * It exists in the enum for the readiness check, where "any symptoms?" is a question that needs a
 * negative answer. Raising a concern is not that question — someone opening this sheet is saying
 * something is wrong, and offering them "nothing in particular" invites a report that says
 * nothing and still costs a supervisor the trip to read it.
 */
const OFFERED: SymptomFlag[] = [
  "DIZZINESS",
  "NAUSEA",
  "HEADACHE",
  "FATIGUE",
  "MUSCLE_CRAMPS",
  "OTHER",
];

/** Matches `@Size(max = 500)` on the server, so an over-long note fails here, not after a trip. */
const MAX_NOTE = 500;

interface RaiseConcernSheetProps {
  visible: boolean;
  saving: boolean;
  onCancel: () => void;
  onSend: (values: { symptoms: SymptomFlag[]; note?: string }) => void;
}

const RaiseConcernSheet: FC<RaiseConcernSheetProps> = ({ visible, saving, onCancel, onSend }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [selected, setSelected] = useState<SymptomFlag[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  /* Cleared on every open — the component stays mounted, and a second concern arriving
     pre-filled with the first one's symptoms would be a report the worker never made. */
  useEffect(() => {
    if (!visible) return;
    setSelected([]);
    setNote("");
    setError(null);
  }, [visible]);

  const toggle = (symptom: SymptomFlag) => {
    setError(null);
    setSelected((current) =>
      current.includes(symptom)
        ? current.filter((value) => value !== symptom)
        : [...current, symptom],
    );
  };

  const submit = () => {
    // Mirrors the server: an empty concern says nothing anyone can act on.
    if (selected.length === 0 && !note.trim()) {
      setError(t("wellbeing.concernEmpty"));
      return;
    }
    onSend({ symptoms: selected, note: note.trim() ? note.trim() : undefined });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="title">{t("wellbeing.concernTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("wellbeing.concernBody")}
          </AppText>

          <AppText variant="label" style={styles.label}>
            {t("wellbeing.symptomsLabel")}
          </AppText>

          <View style={styles.chips}>
            {OFFERED.map((symptom) => {
              const isSelected = selected.includes(symptom);
              return (
                <TouchableOpacity
                  key={symptom}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  onPress={() => toggle(symptom)}
                  activeOpacity={0.8}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isSelected ? theme.colors.primary : theme.colors.surface,
                      borderColor: isSelected ? theme.colors.primary : theme.colors.borderStrong,
                      borderWidth: theme.metrics.borderWidth,
                      borderRadius: theme.metrics.radius,
                      minHeight: theme.metrics.minTouchTarget,
                    },
                  ]}
                >
                  <AppText
                    variant="label"
                    style={{
                      color: isSelected ? theme.colors.onPrimary : theme.colors.textPrimary,
                      textAlign: "center",
                    }}
                  >
                    {t(`symptoms.${symptom}`)}
                  </AppText>
                </TouchableOpacity>
              );
            })}
          </View>

          <AppTextInput
            label={t("wellbeing.noteLabel")}
            placeholder={t("wellbeing.notePlaceholder")}
            value={note}
            onChangeText={(next) => {
              setNote(next);
              setError(null);
            }}
            multiline
            maxLength={MAX_NOTE}
          />

          {error ? (
            <View style={styles.block}>
              <MessageBanner message={error} tone="danger" />
            </View>
          ) : null}

          <AppButton
            title={saving ? t("wellbeing.concernSending") : t("wellbeing.concernSend")}
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

export default RaiseConcernSheet;

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  content: {
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(24),
    gap: vs(10),
  },
  label: {
    marginTop: vs(6),
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    // Negative margin pairs with the per-chip margin so wrapped rows stay evenly spaced without
    // a trailing gap on the right.
    marginHorizontal: -s(3),
  },
  chip: {
    flexGrow: 1,
    // Two per row at default text size, one per row at the largest — they wrap rather than
    // shrinking their labels, which is the trade SegmentedControl already makes.
    minWidth: s(140),
    justifyContent: "center",
    paddingHorizontal: s(10),
    paddingVertical: vs(8),
    marginHorizontal: s(3),
    marginBottom: vs(6),
  },
  block: {
    marginTop: vs(4),
  },
  action: {
    marginTop: vs(8),
  },
});
