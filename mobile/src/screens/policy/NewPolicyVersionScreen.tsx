/**
 * Author a new heat policy version (SCRUM-120 / US-24).
 *
 * ── IT OPENS PRE-FILLED, AND THAT IS THE DESIGN ─────────────────────────────────────────
 * A version carries thirteen fields. A real MOM revision changes two or three of them — so the
 * form starts as a copy of whatever is currently in force and the safety manager edits the
 * difference. Making someone retype nine unchanged thresholds on a handset is not thoroughness;
 * it is where a transcription error gets introduced into a rule a crew is judged against.
 *
 * A site with no active version gets a blank form and says so, because there is nothing to copy.
 *
 * ── THE VALIDATION MIRRORS THE SERVER, INCLUDING THE RULE THE ANNOTATIONS DO NOT SHOW ───
 * `@DecimalMin` covers the floors. The ordering rule — light ≥ moderate ≥ heavy within a level —
 * lives in `PolicyVersionService` and answers 400, so a form that only checked the annotations
 * would look complete and still be rejected. Both are checked here, along with the unique-label
 * 409, so a server rejection is unreachable in normal use.
 *
 * @author Justin Chua
 */
import { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInput from "@/components/inputs/AppTextInput";
import AppDateField from "@/components/inputs/AppDateField";
import MessageBanner from "@/components/feedback/MessageBanner";
import {
  ALL_THRESHOLD_KEYS,
  EMERGENCY_MAX,
  EMERGENCY_MIN,
  MAX_LABEL,
  MAX_SOURCE,
  THRESHOLD_GRID,
  THRESHOLD_MIN,
  orderingHolds,
  thresholdsOf,
  type ThresholdKey,
} from "@/components/policy/policyThresholds";
import { emergencyStopCompatibilityValue } from "@/components/policy/policyCompatibility";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createPolicyVersion, selectActiveVersion } from "@/store/reducers/policySlice";
import { showToast } from "@/store/reducers/uiSlice";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { useTheme } from "@/theme/ThemeProvider";

/** Blank thresholds, for a site that has nothing to copy from. */
const EMPTY_THRESHOLDS = ALL_THRESHOLD_KEYS.reduce(
  (acc, key) => {
    acc[key] = "";
    return acc;
  },
  {} as Record<ThresholdKey, string>,
);

export default function NewPolicyVersionScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation();

  const user = useAppSelector((state) => state.auth.user);
  const active = useAppSelector(selectActiveVersion);
  const creating = useAppSelector((state) => state.policy.creating);
  const selectedSiteId = useAppSelector((state) => state.shifts.selectedSiteId);

  const siteId = selectedSiteId ?? user?.siteIds[0] ?? null;

  /*
   * Seeded once, on mount. Deliberately not kept in sync with `active` afterwards: a background
   * refresh that changed the active version mid-edit would silently rewrite numbers the safety
   * manager had already adjusted.
   */
  const [thresholds, setThresholds] = useState<Record<ThresholdKey, string>>(() =>
    active ? thresholdsOf(active) : EMPTY_THRESHOLDS,
  );
  const [emergencyStop, setEmergencyStop] = useState(active ? String(emergencyStopCompatibilityValue(active)) : "");

  // The label is never copied — a new version needs its own, and the server rejects a duplicate.
  const [label, setLabel] = useState("");
  const [source, setSource] = useState(active?.source ?? "");
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const setThreshold = (key: ThresholdKey, value: string) => {
    setFieldError(null);
    setThresholds((current) => ({ ...current, [key]: value }));
  };

  /** Every server constraint, in the order a reader would check them. */
  const validate = useMemo(
    () => () => {
      if (!label.trim()) return t("policy.validation.labelRequired");
      if (label.trim().length > MAX_LABEL) {
        return t("policy.validation.labelTooLong", { max: MAX_LABEL });
      }
      if (!source.trim()) return t("policy.validation.sourceRequired");
      if (source.trim().length > MAX_SOURCE) {
        return t("policy.validation.sourceTooLong", { max: MAX_SOURCE });
      }
      if (!effectiveDate) return t("policy.validation.dateRequired");

      const values = ALL_THRESHOLD_KEYS.map((key) => thresholds[key]);
      if (values.some((value) => !value.trim())) {
        return t("policy.validation.thresholdRequired");
      }
      if (values.some((value) => Number.isNaN(Number(value)) || Number(value) < THRESHOLD_MIN)) {
        return t("policy.validation.thresholdMin", { min: THRESHOLD_MIN });
      }

      const stop = Number(emergencyStop);
      if (!emergencyStop.trim() || Number.isNaN(stop) || stop < EMERGENCY_MIN || stop > EMERGENCY_MAX) {
        return t("policy.validation.emergencyRange", { min: EMERGENCY_MIN, max: EMERGENCY_MAX });
      }

      // The rule the annotations do not carry. Harder work needs a lower threshold.
      if (!orderingHolds(thresholds)) return t("policy.validation.ordering");

      return null;
    },
    [effectiveDate, emergencyStop, label, source, t, thresholds],
  );

  const onSubmit = async () => {
    const problem = validate();
    if (problem) {
      setFieldError(problem);
      return;
    }
    if (!siteId || !effectiveDate) return;

    const result = await dispatch(
      createPolicyVersion({
        siteId,
        input: {
          versionLabel: label.trim(),
          source: source.trim(),
          effectiveDate,
          ...thresholds,
          wbgtEmergencyStop: emergencyStop.trim(),
          // Omitted rather than sent empty: "" would be stored as a note nobody wrote.
          notes: notes.trim() ? notes.trim() : undefined,
        },
      }),
    );

    if (createPolicyVersion.fulfilled.match(result)) {
      dispatch(showToast({ messageKey: "policy.statusDraft", tone: "success" }));
      navigation.goBack();
      return;
    }

    /* A 409 here means the label is taken — a fixable mistake in a field on this screen, so it
       is reported inline rather than as an Alert that would cover the field to correct. */
    const key = result.payload?.errorKey ?? "errors.unknown";
    if (key === "errors.conflict") {
      setFieldError(t("policy.duplicateLabel"));
      return;
    }
    setErrorKey(key);
    Alert.alert(t("policy.createFailedTitle"), t(key), [{ text: t("common.close") }]);
  };

  return (
    <AppSafeView>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Said up front: a safety manager needs to know these numbers are inherited before
            they read them as ones they entered. */}
        <MessageBanner
          message={
            active
              ? t("policy.clonedFrom", { label: active.versionLabel })
              : t("policy.clonedFromNone")
          }
          tone="info"
        />

        {errorKey ? (
          <View style={styles.block}>
            <MessageBanner message={t(errorKey)} tone="danger" />
          </View>
        ) : null}

        <View style={styles.block}>
          <AppTextInput
            label={t("policy.labelField")}
            placeholder={t("policy.labelPlaceholder")}
            value={label}
            onChangeText={(next) => {
              setLabel(next);
              setFieldError(null);
            }}
            maxLength={MAX_LABEL}
          />

          <AppTextInput
            label={t("policy.sourceField")}
            placeholder={t("policy.sourcePlaceholder")}
            value={source}
            onChangeText={(next) => {
              setSource(next);
              setFieldError(null);
            }}
            maxLength={MAX_SOURCE}
            multiline
          />

          <AppDateField
            label={t("policy.effectiveDateField")}
            placeholder={t("policy.pickDate")}
            value={effectiveDate}
            onChange={(next) => {
              setEffectiveDate(next);
              setFieldError(null);
            }}
            locale={i18n.language}
          />
        </View>

        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("policy.thresholdsTitle")}
        </AppText>

        {THRESHOLD_GRID.map((row) => (
          <View
            key={row.level}
            style={[
              styles.card,
              cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
              { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
            ]}
          >
            <AppText variant="caption" tone="secondary">
              {t("policy.levelHint")}
            </AppText>
            <AppText variant="label" style={styles.levelTitle}>
              {t(`policy.level${row.level}`)}
            </AppText>

            {row.cells.map((cell) => (
              <AppTextInput
                key={cell.key}
                label={t(`intensity.${cell.intensity}`)}
                value={thresholds[cell.key]}
                onChangeText={(next) => setThreshold(cell.key, next)}
                keyboardType="decimal-pad"
                // Enough for "28.50" and nothing that could be a paste of something else.
                maxLength={5}
              />
            ))}
          </View>
        ))}

        <View
          style={[
            styles.card,
            cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
            {
              borderRadius: theme.metrics.radius,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.danger,
            },
          ]}
        >
          <AppTextInput
            label={t("policy.emergencyStop")}
            value={emergencyStop}
            onChangeText={(next) => {
              setEmergencyStop(next);
              setFieldError(null);
            }}
            keyboardType="decimal-pad"
            maxLength={5}
          />
        </View>

        <AppTextInput
          label={t("policy.notesField")}
          placeholder={t("policy.notesPlaceholder")}
          value={notes}
          onChangeText={setNotes}
          multiline
        />

        {/* Repeated next to the button that was just pressed: a failing threshold can be well
            off-screen on this form, and "nothing happened" is not an answer. */}
        {fieldError ? (
          <View style={styles.block}>
            <MessageBanner message={fieldError} tone="danger" />
          </View>
        ) : null}

        <AppButton
          title={creating ? t("policy.saving") : t("policy.save")}
          loading={creating}
          onPress={() => void onSubmit()}
          style={styles.action}
        />
      </ScrollView>
    </AppSafeView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: sharedPaddingHorizontal,
    paddingVertical: vs(12),
  },
  block: {
    marginTop: vs(12),
  },
  sectionTitle: {
    marginTop: vs(8),
    marginBottom: vs(6),
  },
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  levelTitle: {
    marginBottom: vs(8),
  },
  action: {
    marginTop: vs(8),
  },
});
