/**
 * @author Jemilin Beulah
 */
import { apiFetch } from "./client";
import { ApiError } from "./errors";

export type PolicyVersionStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";

/** Mirrors PolicyVersionController.PolicyVersionResponse field for field. */
export interface PolicyVersion {
  id: string;
  siteId: string;
  versionLabel: string;
  source: string;
  effectiveDate: string;
  status: PolicyVersionStatus;
  wbgtThresholdUnacclimatisedLight: number;
  wbgtThresholdUnacclimatisedModerate: number;
  wbgtThresholdUnacclimatisedHeavy: number;
  wbgtThresholdPartialLight: number;
  wbgtThresholdPartialModerate: number;
  wbgtThresholdPartialHeavy: number;
  wbgtThresholdFullLight: number;
  wbgtThresholdFullModerate: number;
  wbgtThresholdFullHeavy: number;
  wbgtEmergencyStop: number;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  supersededAt: string | null;
}

/** Mirrors PolicyVersionController.PolicyVersionCreateRequest field for field. */
export interface PolicyVersionCreateRequest {
  versionLabel: string;
  source: string;
  effectiveDate: string;
  wbgtThresholdUnacclimatisedLight: number;
  wbgtThresholdUnacclimatisedModerate: number;
  wbgtThresholdUnacclimatisedHeavy: number;
  wbgtThresholdPartialLight: number;
  wbgtThresholdPartialModerate: number;
  wbgtThresholdPartialHeavy: number;
  wbgtThresholdFullLight: number;
  wbgtThresholdFullModerate: number;
  wbgtThresholdFullHeavy: number;
  wbgtEmergencyStop: number;
  notes?: string;
}

/** The full version history for a site, newest effective date first. */
export function fetchPolicyVersions(siteId: string): Promise<PolicyVersion[]> {
  return apiFetch<PolicyVersion[]>(`/api/v1/sites/${siteId}/policy-versions`);
}

/**
 * The version currently governing recommendations for a site, or null if none has been
 * configured yet (the server 404s here for a brand-new site with no versions at all).
 */
export function fetchActivePolicyVersion(siteId: string): Promise<PolicyVersion | null> {
  return apiFetch<PolicyVersion>(`/api/v1/sites/${siteId}/policy-versions/active`).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.kind === "not-found") return null;
      throw error;
    },
  );
}

export function createPolicyVersion(
  siteId: string,
  body: PolicyVersionCreateRequest,
): Promise<PolicyVersion> {
  return apiFetch<PolicyVersion>(`/api/v1/sites/${siteId}/policy-versions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function activatePolicyVersion(siteId: string, versionId: string): Promise<PolicyVersion> {
  return apiFetch<PolicyVersion>(`/api/v1/sites/${siteId}/policy-versions/${versionId}/activate`, {
    method: "POST",
  });
}
