/**
 * @author Jemilin Beulah
 */
import { apiFetch } from "./client";
import type { Role } from "./identity";

export type UserStatus = "ACTIVE" | "INACTIVE";

/** Mirrors AdminSiteController.SiteResponse field for field. */
export interface AdminSite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  archived: boolean;
  createdAt: string;
}

/** Mirrors AdminSiteController.SiteWriteRequest field for field. */
export interface SiteWriteRequest {
  name: string;
  latitude: number;
  longitude: number;
}

/** Mirrors AdminUserController.UserResponse field for field. */
export interface AdminUser {
  id: string;
  username: string;
  cognitoSub: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  siteIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Mirrors AdminUserController.UserRegisterRequest field for field. */
export interface UserRegisterRequest {
  username: string;
  cognitoSub: string;
  displayName: string;
  role: Role;
  siteIds: string[];
}

/** Mirrors AdminUserController.UserUpdateRequest — a partial update, omitted fields unchanged. */
export interface UserUpdateRequest {
  role?: Role;
  status?: UserStatus;
}

/** Every site, including archived ones — so an admin can find one to unarchive. */
export function fetchAdminSites(): Promise<AdminSite[]> {
  return apiFetch<AdminSite[]>("/api/v1/admin/sites");
}

export function createSite(body: SiteWriteRequest): Promise<AdminSite> {
  return apiFetch<AdminSite>("/api/v1/admin/sites", { method: "POST", body: JSON.stringify(body) });
}

export function updateSite(siteId: string, body: SiteWriteRequest): Promise<AdminSite> {
  return apiFetch<AdminSite>(`/api/v1/admin/sites/${siteId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function archiveSite(siteId: string): Promise<AdminSite> {
  return apiFetch<AdminSite>(`/api/v1/admin/sites/${siteId}/archive`, { method: "POST" });
}

export function unarchiveSite(siteId: string): Promise<AdminSite> {
  return apiFetch<AdminSite>(`/api/v1/admin/sites/${siteId}/unarchive`, { method: "POST" });
}

export function fetchAdminUsers(): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/api/v1/admin/users");
}

/** Registers a local app_user row for a Cognito identity that already exists — see
 * AdminUserController's javadoc. Never creates the Cognito identity itself. */
export function registerUser(body: UserRegisterRequest): Promise<AdminUser> {
  return apiFetch<AdminUser>("/api/v1/admin/users", { method: "POST", body: JSON.stringify(body) });
}

export function updateUser(userId: string, body: UserUpdateRequest): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/v1/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function grantSiteMembership(userId: string, siteId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/users/${userId}/site-memberships`, {
    method: "POST",
    body: JSON.stringify({ siteId }),
  });
}

export function revokeSiteMembership(userId: string, siteId: string): Promise<void> {
  return apiFetch<void>(`/api/v1/admin/users/${userId}/site-memberships/${siteId}`, {
    method: "DELETE",
  });
}
