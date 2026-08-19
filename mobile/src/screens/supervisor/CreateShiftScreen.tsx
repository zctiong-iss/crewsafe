/**
 * Create a shift (SCRUM-161).
 *
 * ── WHY THE CLIENT VALIDATION HAS TO BE COMPLETE ────────────────────────────────────────
 * The story's acceptance is "validation errors are surfaced per field, not as a generic
 * failure". That cannot come from the server: `GlobalExceptionHandler` maps every
 * `MethodArgumentNotValidException` to `{"error":"Bad Request","message":"Invalid request
 * parameters"}` with no field detail at all, deliberately — its stated rule is that no
 * exception message ever reaches the caller, because messages leak SQL fragments and class
 * names.
 *
 * So per-field feedback is only achievable by making a server 400 unreachable in normal use.
 * Every constraint below mirrors one in `docs/api/shift.yaml` and `ShiftService`, and a 400
 * that still arrives is reported as a whole-form error with the request id — because at that
 * point the server genuinely has not said which field, and inventing a guess would be worse
 * than admitting it.
 *
 * ── THE RULES, AND WHERE EACH COMES FROM ────────────────────────────────────────────────
 *   startsAt, endsAt required        @NotNull on ShiftCreateRequest
 *   endsAt strictly after startsAt   ShiftService: `if (!endsAt.isAfter(startsAt)) throw` —
 *                                    note *strictly*; equal times are rejected server-side
 *   taskName <= 120 chars            @Size(max = 120)
 *   intensity required, fixed set    @NotNull Intensity; "never free text… an unrecognised
 *                                    value must be rejected, not guessed at"
 *   acclimatisationDay 1..7 or null  @Min(1) @Max(7), nullable
 *
 * Two things the server does *not* check, which the UI shape prevents instead:
 *   • the same worker twice — impossible here because the crew is a multi-select, one row
 *     per worker, rather than a repeatable "add worker" list
 *   • a worker who does not belong to this site — the picker is populated from
 *     GET /sites/{id}/workers, so there is nothing else to choose
 *
 * @author Justin Chua
 */
import { useCallback, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Controller, useFieldArray, useForm, type Resolver } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { s, vs } from "react-native-size-matters";

import AppSafeView from "@/components/views/AppSafeView";
import AppText from "@/components/texts/AppText";
import AppButton from "@/components/buttons/AppButton";
import AppTextInput from "@/components/inputs/AppTextInput";
import AppDateTimeField from "@/components/inputs/AppDateTimeField";
import SegmentedControl from "@/components/inputs/SegmentedControl";
import MessageBanner from "@/components/feedback/MessageBanner";
import RadioWithTitle from "@/components/inputs/RadioWithTitle";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { createShift } from "@/store/reducers/shiftsSlice";
import { showToast } from "@/store/reducers/uiSlice";
import { sharedPaddingHorizontal, cardSurface } from "@/styles/sharedStyles";
import { intensityColor } from "@/helpers/intensityColor";
import { useTheme } from "@/theme/ThemeProvider";
import type { Intensity } from "@/types/domain";
import type { ShiftsStackParamList } from "@/navigation/types";

/** `@Size(max = 120)` on ShiftAssignmentCreateRequest.taskName. */
const MAX_TASK_LENGTH = 120;

const INTENSITIES: Intensity[] = ["LIGHT", "MODERATE", "HEAVY"];

interface AssignmentValues {
  workerId: string;
  /** Rendering only — never sent. The server resolves names from the worker id. */
  displayName: string;
  taskName: string;
  intensity: Intensity;
  /** Held as text because it comes from a keyboard; parsed to a number on submit. */
  acclimatisationDay: string;
}

interface FormValues {
  startsAt: Date | null;
  endsAt: Date | null;
  assignments: AssignmentValues[];
}

export function isEndAfterStart(startsAt: Date | null, endsAt: Date | null): boolean {
  if (!startsAt || !endsAt) return true;
  return endsAt.getTime() > startsAt.getTime();
}

export default function CreateShiftScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const dispatch = useAppDispatch();
  const navigation = useNavigation<NativeStackNavigationProp<ShiftsStackParamList>>();
  const route = useRoute<RouteProp<ShiftsStackParamList, "CreateShift">>();

  const workers = useAppSelector((state) => state.shifts.workers);
  const creating = useAppSelector((state) => state.shifts.creating);
  const selectedSiteId = useAppSelector((state) => state.shifts.selectedSiteId);

  const siteId = route.params?.siteId ?? selectedSiteId ?? "";

  /*
   * Rebuilt when `t` changes so a language switch re-renders the messages rather than
   * leaving whichever language was active when the schema was first created.
   */
  const schema = useMemo(
    () =>
      yup.object({
        startsAt: yup
          .date()
          .nullable()
          .required(t("shifts.validation.startRequired")),
        endsAt: yup
          .date()
          .nullable()
          .required(t("shifts.validation.endRequired"))
          .test(
            "after-start",
            t("shifts.validation.endNotAfterStart"),
            (value, context) => {
              const startsAt = context.parent.startsAt as Date | null;
              // Only compares once both exist; `required` reports the missing one.
              if (!value || !startsAt) return true;
              // Strictly after, matching `!endsAt.isAfter(startsAt)` in ShiftService —
              // equal timestamps are a 400 server-side, so they must fail here too.
              return isEndAfterStart(startsAt, value);
            },
          ),
        assignments: yup.array().of(
          yup.object({
            workerId: yup.string().required(),
            displayName: yup.string().required(),
            taskName: yup
              .string()
              .max(MAX_TASK_LENGTH, t("shifts.validation.taskTooLong", { max: MAX_TASK_LENGTH })),
            intensity: yup
              .string()
              .oneOf(INTENSITIES, t("shifts.validation.intensityRequired"))
              .required(t("shifts.validation.intensityRequired")),
            acclimatisationDay: yup
              .string()
              .test("range", t("shifts.validation.acclimatisationRange"), (value) => {
                // Optional: blank is a fully acclimatised worker, which is the common case.
                if (!value || value.trim() === "") return true;
                const parsed = Number(value);
                return Number.isInteger(parsed) && parsed >= 1 && parsed <= 7;
              }),
          }),
        ),
      }),
    [t],
  );

  /*
   * The form's shape is declared rather than inferred from the schema.
   *
   * `yup.date().nullable().required()` infers `Date` for the *output* — correct, since a
   * validated form cannot have a null date — but the *input* starts as null, because a
   * supervisor has not picked a time yet. Inferring from the schema makes `defaultValues:
   * { startsAt: null }` a type error and would push you toward seeding the field with
   * `new Date()`, which silently pre-fills an answer the user never gave.
   */
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: yupResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues: { startsAt: null, endsAt: null, assignments: [] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "assignments" });

  const selectedIds = useMemo(() => fields.map((field) => field.workerId), [fields]);

  const toggleWorker = useCallback(
    (workerId: string, displayName: string) => {
      const index = fields.findIndex((field) => field.workerId === workerId);
      if (index >= 0) {
        remove(index);
        return;
      }
      append({
        workerId,
        displayName,
        taskName: "",
        // MODERATE rather than blank: it is the middle of the three and the most common,
        // and an unset intensity would fail validation on a field the supervisor may not
        // have realised was theirs to answer.
        intensity: "MODERATE",
        acclimatisationDay: "",
      });
    },
    [append, fields, remove],
  );

  const onSubmit = handleSubmit(async (data) => {
    const result = await dispatch(
      createShift({
        siteId,
        // ISO 8601 UTC, per §12.2. `toISOString` is always UTC, so the site's local time
        // picked above is converted once, here, and never sent as a naive local string.
        startsAt: (data.startsAt as Date).toISOString(),
        endsAt: (data.endsAt as Date).toISOString(),
        assignments: (data.assignments ?? []).map((assignment) => ({
          workerId: assignment.workerId,
          // Omitted rather than sent empty: the contract makes taskName optional, and ""
          // is a value that would be stored as an empty task rather than no task.
          taskName: assignment.taskName?.trim() ? assignment.taskName.trim() : undefined,
          intensity: assignment.intensity as Intensity,
          acclimatisationDay: assignment.acclimatisationDay?.trim()
            ? Number(assignment.acclimatisationDay)
            : undefined,
        })),
      }),
    );

    if (createShift.fulfilled.match(result)) {
      dispatch(showToast({ messageKey: "shifts.form.createdToast", tone: "success" }));
      navigation.goBack();
      return;
    }

    /*
     * A rejection here is either a 403 (the story's cross-site case), a network failure, or
     * a 400 the client validation failed to prevent. All three go to the form's root rather
     * than to a field — the server did not name one, and attaching a guessed field to a
     * server error would point the supervisor at the wrong input.
     */
    setError("root", { message: t(result.payload?.errorKey ?? "errors.unknown") });
  });

  const assignmentErrors = errors.assignments;

  return (
    <AppSafeView>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {errors.root?.message ? (
          <View style={styles.block}>
            <MessageBanner message={errors.root.message} tone="danger" />
          </View>
        ) : null}

        {/* ─────────────────────────── When ─────────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("shifts.form.timesSection")}
        </AppText>

        <Controller
          control={control}
          name="startsAt"
          render={({ field: { value, onChange }, fieldState }) => (
            <AppDateTimeField
              label={t("shifts.form.startsAt")}
              placeholder={t("shifts.form.pickDateTime")}
              value={(value as Date | null) ?? null}
              onChange={onChange}
              errorMessage={fieldState.error?.message}
              locale={i18n.language}
            />
          )}
        />

        <Controller
          control={control}
          name="endsAt"
          render={({ field: { value, onChange }, fieldState }) => (
            <AppDateTimeField
              label={t("shifts.form.endsAt")}
              placeholder={t("shifts.form.pickDateTime")}
              value={(value as Date | null) ?? null}
              onChange={onChange}
              errorMessage={fieldState.error?.message}
              locale={i18n.language}
            />
          )}
        />

        {/* ─────────────────────────── Crew ─────────────────────────── */}
        <AppText variant="subtitle" style={styles.sectionTitle}>
          {t("shifts.form.crewSection")}
        </AppText>
        <AppText variant="caption" tone="secondary" style={styles.sectionHint}>
          {t("shifts.form.crewHint")}
        </AppText>

        {workers.length === 0 ? (
          <AppText variant="body" tone="secondary" style={styles.block}>
            {t("shifts.form.noWorkers")}
          </AppText>
        ) : (
          workers.map((worker) => (
            <RadioWithTitle
              key={worker.id}
              title={worker.displayName}
              selected={selectedIds.includes(worker.id)}
              onPress={() => toggleWorker(worker.id, worker.displayName)}
            />
          ))
        )}

        {/* ──────────────────── Per-worker assignment ──────────────────── */}
        {fields.length > 0 ? (
          <>
            <AppText variant="subtitle" style={[styles.sectionTitle, styles.gapTop]}>
              {t("shifts.form.assignmentsSection")}
            </AppText>

            {fields.map((field, index) => (
              <View
                key={field.id}
                style={[
                  styles.card,
                  cardSurface(theme.highContrast, theme.colors.border, theme.metrics.borderWidth),
                  { borderRadius: theme.metrics.radius, backgroundColor: theme.colors.surface },
                ]}
              >
                <AppText variant="body" style={styles.workerName}>
                  {field.displayName}
                </AppText>

                <Controller
                  control={control}
                  name={`assignments.${index}.taskName`}
                  render={({ field: { value, onChange, onBlur }, fieldState }) => (
                    <AppTextInput
                      label={t("shifts.form.taskLabel")}
                      placeholder={t("shifts.form.taskPlaceholder")}
                      hint={t("shifts.form.taskHint", { max: MAX_TASK_LENGTH })}
                      value={value ?? ""}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      // Stops an over-long paste at the source; the yup rule remains the
                      // authority and matches @Size(max = 120).
                      maxLength={MAX_TASK_LENGTH}
                      errorMessage={fieldState.error?.message}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name={`assignments.${index}.intensity`}
                  render={({ field: { value, onChange }, fieldState }) => (
                    <SegmentedControl<Intensity>
                      label={t("shifts.form.intensityLabel")}
                      options={INTENSITIES.map((intensity) => ({
                        value: intensity,
                        label: t(`intensity.${intensity}`),
                      }))}
                      value={(value as Intensity | null) ?? null}
                      onChange={onChange}
                      errorMessage={fieldState.error?.message}
                      selectedColorFor={(intensity) => intensityColor(theme.colors, intensity)}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name={`assignments.${index}.acclimatisationDay`}
                  render={({ field: { value, onChange, onBlur }, fieldState }) => (
                    <AppTextInput
                      label={t("shifts.form.acclimatisationLabel")}
                      placeholder={t("shifts.form.acclimatisationPlaceholder")}
                      hint={t("shifts.form.acclimatisationHint")}
                      value={value ?? ""}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      keyboardType="number-pad"
                      maxLength={1}
                      errorMessage={fieldState.error?.message}
                    />
                  )}
                />

                {/* Not "Cancel" — this takes one worker off the shift, it does not abandon
                    the form. Mislabelling it would make a supervisor hesitate to press the
                    only control that fixes a wrongly-added person. */}
                <AppButton
                  title={t("shifts.form.removeWorker")}
                  variant="secondary"
                  onPress={() => remove(index)}
                />
              </View>
            ))}
          </>
        ) : (
          // Not a validation error: the contract is explicit that a shift may be created
          // empty and staffed later, so this states the outcome instead of blocking it.
          <View style={styles.block}>
            <MessageBanner message={t("shifts.form.unstaffedNotice")} tone="info" />
          </View>
        )}

        {/*
          A per-worker error can be well off-screen on a six-person crew, so the fact that
          something failed is repeated next to the button that was just pressed.

          The wording says the fields above need attention — it must not claim the server
          rejected anything, because nothing has been sent yet. Blaming the server for a
          client-side rule would send the supervisor looking for a fault that does not
          exist.
        */}
        {assignmentErrors && !errors.root ? (
          <View style={styles.block}>
            <MessageBanner message={t("shifts.validation.checkFields")} tone="danger" />
          </View>
        ) : null}

        {/*
          `isSubmitting` as well as `creating`, and the order matters.
          `creating` only becomes true once the yup resolver has finished and the thunk has
          dispatched; `isSubmitting` is true from the moment the button is pressed, so it is
          the one that covers the validation window. The thunk's `condition` guard is the
          backstop for a tap that lands before either flag renders.
        */}
        <AppButton
          title={creating || isSubmitting ? t("shifts.form.submitting") : t("shifts.form.submit")}
          loading={creating || isSubmitting}
          onPress={() => void onSubmit()}
          style={styles.block}
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
  sectionTitle: {
    marginBottom: vs(6),
  },
  sectionHint: {
    marginBottom: vs(10),
  },
  gapTop: {
    marginTop: vs(16),
  },
  block: {
    marginTop: vs(12),
  },
  card: {
    padding: s(14),
    marginBottom: vs(12),
  },
  workerName: {
    marginBottom: vs(10),
  },
});
