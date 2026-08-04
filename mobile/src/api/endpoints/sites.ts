import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import { mockAccessibleSites } from "../mock/sites";
import type { Site } from "@/types/domain";

/**
 * `GET /api/v1/sites` — the sites this user may reach.
 *
 * Real endpoint. Returning an empty list is a legitimate answer, not an error: a new
 * starter with no memberships yet is correctly authenticated and correctly sees nothing,
 * and `SiteController` says so explicitly. Screens must handle that rather than treating it
 * as a failure.
 *
 * `siteIds` is only used by the mock, which has no membership table to filter against.
 */
export function fetchAccessibleSites(siteIds: string[]): Promise<Site[]> {
  if (isMockApi()) {
    return new Promise((resolve) => setTimeout(() => resolve(mockAccessibleSites(siteIds)), 250));
  }

  return request<Site[]>({ url: "/api/v1/sites", method: "GET" });
}
