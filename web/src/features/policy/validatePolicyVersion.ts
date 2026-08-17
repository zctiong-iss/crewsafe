/**
 * @author Jemilin Beulah
 */
import type { PolicyVersionCreateRequest } from "@/api/policy";
import { THRESHOLD_GROUPS } from "./thresholds";

export type FieldErrors = Record<string, string>;

const MIN_THRESHOLD = 15;
const MIN_EMERGENCY_STOP = 20;
const MAX_EMERGENCY_STOP = 40;
const MAX_LABEL_LENGTH = 64;
const MAX_SOURCE_LENGTH = 255;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * Mirrors PolicyVersionService's rules client-side, so a Safety Manager sees a mistake before
 * submitting rather than as a 400 from the server. Every rule here is also enforced there —
 * this is convenience, not the control.
 */
export function validatePolicyVersion(draft: Partial<PolicyVersionCreateRequest>): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.versionLabel || draft.versionLabel.trim() === "") {
    errors.versionLabel = "Enter a version label.";
  } else if (draft.versionLabel.length > MAX_LABEL_LENGTH) {
    errors.versionLabel = `Keep the label to ${MAX_LABEL_LENGTH} characters or fewer.`;
  }

  if (!draft.source || draft.source.trim() === "") {
    errors.source = "Enter a source for this version.";
  } else if (draft.source.length > MAX_SOURCE_LENGTH) {
    errors.source = `Keep the source to ${MAX_SOURCE_LENGTH} characters or fewer.`;
  }

  if (!draft.effectiveDate) {
    errors.effectiveDate = "Enter an effective date.";
  }

  for (const group of THRESHOLD_GROUPS) {
    for (const field of [group.light, group.moderate, group.heavy] as const) {
      const value = draft[field];
      if (!isNumber(value)) {
        errors[field] = "Enter a threshold.";
      } else if (value < MIN_THRESHOLD) {
        errors[field] = `Must be at least ${MIN_THRESHOLD}°C.`;
      }
    }

    const light = draft[group.light];
    const moderate = draft[group.moderate];
    const heavy = draft[group.heavy];

    if (!errors[group.moderate] && isNumber(light) && isNumber(moderate) && light < moderate) {
      errors[group.moderate] = "Moderate threshold cannot be higher than light.";
    }
    if (!errors[group.heavy] && isNumber(moderate) && isNumber(heavy) && moderate < heavy) {
      errors[group.heavy] = "Heavy threshold cannot be higher than moderate.";
    }
  }

  const stop = draft.wbgtEmergencyStop;
  if (!isNumber(stop)) {
    errors.wbgtEmergencyStop = "Enter an emergency stop threshold.";
  } else if (stop < MIN_EMERGENCY_STOP || stop > MAX_EMERGENCY_STOP) {
    errors.wbgtEmergencyStop = `Must be between ${MIN_EMERGENCY_STOP}°C and ${MAX_EMERGENCY_STOP}°C.`;
  }

  return errors;
}
