/**
 * @author Jemilin Beulah
 */
import { apiFetch } from "./client";

/** Mirrors MeResponse on the backend. */
export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  siteIds: string[];
}

export type Role = "WORKER" | "SUPERVISOR" | "SAFETY_MANAGER" | "ADMIN";

/** Mirrors SiteController.SiteResponse. */
export interface Site {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>("/api/v1/me");
}

export function fetchAccessibleSites(): Promise<Site[]> {
  return apiFetch<Site[]>("/api/v1/sites");
}
