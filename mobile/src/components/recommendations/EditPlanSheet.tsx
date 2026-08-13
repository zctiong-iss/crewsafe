/**
 * Narrowing a drafted plan before sending it (SCRUM-119 / US-09).
 *
 * ── WHY YOU CANNOT ADD AN ACTION HERE ───────────────────────────────────────────────────
 * Remove, reorder, reword — but not invent. US-08's acceptance is "no unsupported actions", and
 * an action a supervisor typed in has no policy rule and no forecast behind it: it would appear
 * beside actions that do, formatted identically, with nothing on screen to tell them apart. The
 * server enforces the same boundary from the other side by rejecting any action code outside
 * `ActionCatalogue`.
 *
 * ── A REQUIRED ACTION CANNOT BE STRUCK OUT ──────────────────────────────────────────────
 * `origin: MANDATORY` means the policy engine requires the action — it is not the agent's
 * suggestion, it is the rule the site is judged against. Letting a supervisor quietly drop one
 * while narrowing a plan is the failure the SCRUM-118 design exists to prevent: the crew would
 * then be working without a legally required control, and the record would show a plan somebody
 * approved. So those rows carry a Required badge and have no remove control at all, with the
 * reason said in words rather than left to a disabled button.
 *
 * Advisory actions remain removable. That is the whole distinction the field exists to draw.
 *
 * ── REMOVED, NOT DELETED ────────────────────────────────────────────────────────────────
 * A removed row stays visible, struck through, and can be restored. A supervisor pruning a
 * six-action plan needs to see what they have taken out — a list that silently shrinks gives them
 * no way to check their own work before it reaches a crew.
 *
 * ── WHY THE WORDING IS EDITABLE AT ALL ──────────────────────────────────────────────────
 * The `actionCode` is what a worker's device renders, in their own language, and editing the text
 * does not change it. The text is what a *supervisor* reads here and what is kept on the record as
 * the plan they approved — so a correction ("east verge, not west") is worth allowing, and cannot
 * alter the instruction the crew receives.
 *
 * @author Justin Chua
 */
import { useEffect, useState, type FC } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInput from "@/components/inputs/AppTextInput";
import MessageBanner from "@/components/feedback/MessageBanner";
import MitigationRow from "./MitigationRow";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";
import type { Mitigation } from "@/types/domain";

interface EditPlanSheetProps {
  visible: boolean;
  mitigations: Mitigation[];
  saving: boolean;
  onCancel: () => void;
  onSend: (editedPlan: Mitigation[]) => void;
}

interface Draft {
  mitigation: Mitigation;
  removed: boolean;
}

const EditPlanSheet: FC<EditPlanSheetProps> = ({
  visible,
  mitigations,
  saving,
  onCancel,
  onSend,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [draft, setDraft] = useState<Draft[]>([]);

  /* Reset from the recommendation on every open — the component stays mounted, so a supervisor
     who cancels and reopens would otherwise be editing an abandoned attempt. */
  useEffect(() => {
    if (!visible) return;
    setDraft(mitigations.map((mitigation) => ({ mitigation: { ...mitigation }, removed: false })));
  }, [visible, mitigations]);

  const kept = draft.filter((row) => !row.removed);

  const toggleRemoved = (index: number) =>
    setDraft((current) =>
      current.map((row, i) => (i === index ? { ...row, removed: !row.removed } : row)),
    );

  const move = (index: number, delta: number) =>
    setDraft((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const setAction = (index: number, action: string) =>
    setDraft((current) =>
      current.map((row, i) =>
        i === index ? { ...row, mitigation: { ...row.mitigation, action } } : row,
      ),
    );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppText variant="title">{t("recommendations.editTitle")}</AppText>
          <AppText variant="body" tone="secondary">
            {t("recommendations.editHint")}
          </AppText>

          {draft.map((row, index) => {
            // Required by the policy engine, so not this supervisor's to drop.
            const required = row.mitigation.origin === "MANDATORY";
            return (
            <View
              key={`${row.mitigation.actionCode ?? "none"}-${index}`}
              style={[
                styles.card,
                cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
              ]}
            >
              {/* The translated instruction, exactly as the crew will receive it — shown even for
                  a removed row, so what is being taken out stays legible. */}
              <MitigationRow mitigation={row.mitigation} removed={row.removed} showDetail={false} />

              {/* Labelled for what it is: the text kept on the record as the plan the supervisor
                  approved. It is NOT what the crew receives — that comes from the action code
                  above and is already in their own language. */}
              {!row.removed ? (
                <AppTextInput
                  label={t("recommendations.actionWording")}
                  value={row.mitigation.action}
                  onChangeText={(next) => setAction(index, next)}
                  multiline
                />
              ) : null}

              <View style={styles.controls}>
                <AppButton
                  title={t("recommendations.moveUp")}
                  variant="secondary"
                  disabled={index === 0}
                  onPress={() => move(index, -1)}
                  style={styles.control}
                />
                <AppButton
                  title={t("recommendations.moveDown")}
                  variant="secondary"
                  disabled={index === draft.length - 1}
                  onPress={() => move(index, 1)}
                  style={styles.control}
                />
                {required ? null : (
                  <AppButton
                    title={
                      row.removed
                        ? t("recommendations.restoreAction")
                        : t("recommendations.removeAction")
                    }
                    variant="secondary"
                    onPress={() => toggleRemoved(index)}
                    style={styles.control}
                  />
                )}
              </View>

              {/* Said plainly rather than shown as a disabled button: a supervisor is not being
                  denied something they might otherwise do — this was never theirs to remove. */}
              {required ? (
                <AppText variant="caption" tone="secondary" style={styles.requiredNote}>
                  {t("recommendations.requiredCannotRemove")}
                </AppText>
              ) : null}
            </View>
            );
          })}

          {/* Removing everything is not an edit, it is a rejection — and a rejection carries a
              reason on the record, which an empty plan would not. */}
          {kept.length === 0 ? (
            <View style={styles.block}>
              <MessageBanner message={t("recommendations.editEmpty")} tone="danger" />
            </View>
          ) : null}

          <AppButton
            title={saving ? t("recommendations.deciding") : t("recommendations.sendEdited")}
            loading={saving}
            disabled={kept.length === 0}
            onPress={() => onSend(kept.map((row) => row.mitigation))}
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

export default EditPlanSheet;

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  content: {
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(24),
    gap: vs(10),
  },
  card: {
    padding: s(12),
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: vs(8),
    // Negative margin pairs with the per-control margin so a wrapped row stays evenly spaced.
    marginHorizontal: -s(3),
  },
  control: {
    flexGrow: 1,
    minWidth: s(96),
    marginHorizontal: s(3),
    marginBottom: vs(6),
  },
  block: {
    marginTop: vs(4),
  },
  requiredNote: {
    marginTop: vs(6),
  },
  action: {
    marginTop: vs(8),
  },
});
