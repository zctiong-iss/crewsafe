/**
 * @author Jemilin Beulah
 */
import type { SiteWriteRequest } from "@/api/admin";

export type FieldErrors = Record<string, string>;

const MAX_NAME_LENGTH = 120;

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

/**
 * Mirrors AdminSiteController.SiteWriteRequest's validation client-side, so an admin sees a
 * mistake before submitting rather than as a 400 from the server. Every rule here is also
 * enforced there — this is convenience, not the control.
 */
export function validateSite(draft: Partial<SiteWriteRequest>): FieldErrors {
  const errors: FieldErrors = {};

  if (!draft.name || draft.name.trim() === "") {
    errors.name = "Enter a site name.";
  } else if (draft.name.length > MAX_NAME_LENGTH) {
    errors.name = `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  if (!isNumber(draft.latitude)) {
    errors.latitude = "Enter a latitude.";
  } else if (draft.latitude < -90 || draft.latitude > 90) {
    errors.latitude = "Latitude must be between -90 and 90.";
  }

  if (!isNumber(draft.longitude)) {
    errors.longitude = "Enter a longitude.";
  } else if (draft.longitude < -180 || draft.longitude > 180) {
    errors.longitude = "Longitude must be between -180 and 180.";
  }

  return errors;
}
