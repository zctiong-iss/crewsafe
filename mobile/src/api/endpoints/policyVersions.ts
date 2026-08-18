/**
 * The site's heat policy version catalogue (SCRUM-120 / US-24).
 *
 * All four routes are real — `PolicyVersionController` shipped in PR #189 and nothing in this app
 * had ever called them. Only `mock` auth mode diverges, and only for want of a backend.
 *
 * Reading is broader than writing, deliberately:
 *
 *   GET  …/policy-versions            SUPERVISOR / SAFETY_MANAGER / ADMIN
 *   GET  …/policy-versions/active     SUPERVISOR / SAFETY_MANAGER / ADMIN
 *   POST …/policy-versions            SAFETY_MANAGER / ADMIN only
 *   POST …/{id}/activate              SAFETY_MANAGER / ADMIN only
 *
 * A supervisor can see which rules govern their crew — they are judged against them — but changing
 * those rules belongs to the person accountable for them.
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import {
  mockActivatePolicyVersion,
  mockCreatePolicyVersion,
  mockListPolicyVersions,
} from "../mock/policyVersions";
import type { PolicyVersion } from "@/types/domain";

const MOCK_LATENCY_MS = 350;

function delay<T>(produce: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(produce());
      } catch (error) {
        reject(error);
      }
    }, MOCK_LATENCY_MS),
  );
}

/** `GET /api/v1/sites/{siteId}/policy-versions` — the full history, newest effective date first. */
export function fetchPolicyVersions(siteId: string): Promise<PolicyVersion[]> {
  if (isMockApi()) return delay(() => mockListPolicyVersions());
  return request<PolicyVersion[]>({
    url: `/api/v1/sites/${siteId}/policy-versions`,
    method: "GET",
  });
}

/**
 * What a new version is built from, and what the server requires.
 *
 * Thresholds are sent as strings rather than numbers: the server takes `BigDecimal`, and a
 * threshold is a decimal quantity where a float's rounding is a change to a safety rule nobody
 * authored. The form holds them as typed text anyway.
 */
export interface PolicyVersionInput {
  versionLabel: string;
  source: string;
  /** ISO 8601 date only — `YYYY-MM-DD`. Sending a timestamp would not parse as a LocalDate. */
  effectiveDate: string;
  wbgtThresholdUnacclimatisedLight: string;
  wbgtThresholdUnacclimatisedModerate: string;
  wbgtThresholdUnacclimatisedHeavy: string;
  wbgtThresholdPartialLight: string;
  wbgtThresholdPartialModerate: string;
  wbgtThresholdPartialHeavy: string;
  wbgtThresholdFullLight: string;
  wbgtThresholdFullModerate: string;
  wbgtThresholdFullHeavy: string;
  /** Retained for compatibility; ignored by WBGT policy enforcement. */
  wbgtEmergencyStop: string;
  notes?: string;
}

/**
 * `POST /api/v1/sites/{siteId}/policy-versions`.
 *
 * Created `DRAFT`, except for a site's very first version which the server activates on the spot —
 * a site with rules nobody has activated has no rules at all.
 *
 * Answers 409 when the label is already used at this site, and 400 when the thresholds do not
 * satisfy light ≥ moderate ≥ heavy within a level. Both are checked in the form first, so neither
 * should be reachable in normal use.
 */
export function createPolicyVersion(
  siteId: string,
  input: PolicyVersionInput,
): Promise<PolicyVersion> {
  if (isMockApi()) return delay(() => mockCreatePolicyVersion(input));
  return request<PolicyVersion>({
    url: `/api/v1/sites/${siteId}/policy-versions`,
    method: "POST",
    data: input,
  });
}

/**
 * `POST /api/v1/sites/{siteId}/policy-versions/{versionId}/activate`.
 *
 * Retires whatever was active before, in the same transaction. Answers 409 for a `SUPERSEDED`
 * version — that state is terminal, and a version that governed a site once is never quietly
 * brought back.
 */
export function activatePolicyVersion(
  siteId: string,
  versionId: string,
): Promise<PolicyVersion> {
  if (isMockApi()) return delay(() => mockActivatePolicyVersion(versionId));
  return request<PolicyVersion>({
    url: `/api/v1/sites/${siteId}/policy-versions/${versionId}/activate`,
    method: "POST",
  });
}
