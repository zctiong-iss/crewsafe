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
  /** @deprecated Retained for compatibility; ignored by WBGT policy enforcement. */
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
  /** @deprecated Retained for compatibility; ignored by WBGT policy enforcement. */
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

/**
 * A version returned by `/policy-versions/effective` — either the site's own (siteId set,
 * identical shape to {@link PolicyVersion}) or the company-wide default, which has no site.
 */
export type EffectivePolicyVersion = Omit<PolicyVersion, "siteId"> & { siteId: string | null };

/**
 * The version actually governing recommendations for a site right now: its own if it has
 * configured one, otherwise the company-wide default (siteId null) PolicyEngineService falls
 * back to. Unlike {@link fetchActivePolicyVersion}, this does not need the not-found fallback
 * dance — the default makes a 404 practically unreachable.
 */
export function fetchEffectivePolicyVersion(siteId: string): Promise<EffectivePolicyVersion> {
  return apiFetch<EffectivePolicyVersion>(`/api/v1/sites/${siteId}/policy-versions/effective`);
}
