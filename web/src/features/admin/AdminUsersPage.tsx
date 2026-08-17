/**
 * @author Jemilin Beulah
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import {
  fetchAdminSites,
  fetchAdminUsers,
  updateUser,
  type AdminSite,
  type AdminUser,
  type UserStatus,
} from "@/api/admin";
import type { Role } from "@/api/identity";
import { roleLabel } from "@/app/navigation";
import { useCurrentUser } from "@/auth/useAuth";
import { AdminTabs } from "./AdminTabs";
import { SiteMembershipEditor } from "./SiteMembershipEditor";
import "./Admin.css";

const ROLES: readonly Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];

type Load =
  | { status: "loading" }
  | { status: "loaded"; users: AdminUser[]; sites: AdminSite[] }
  | { status: "error"; message: string; requestId: string | null };

export function AdminUsersPage() {
  const currentUser = useCurrentUser();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [editingSitesId, setEditingSitesId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchAdminUsers(), fetchAdminSites()])
      .then(([users, sites]) => active && setLoad({ status: "loaded", users, sites }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => {
      active = false;
    };
  }, []);

  const replaceUser = (updated: AdminUser) => {
    setLoad((current) =>
      current.status === "loaded"
        ? { status: "loaded", users: current.users.map((u) => (u.id === updated.id ? updated : u)), sites: current.sites }
        : current,
    );
  };

  const patchUser = (userId: string, body: { role?: Role; status?: UserStatus }) => {
    setActionError(null);
    updateUser(userId, body)
      .then(replaceUser)
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setActionError(messageFor(apiError));
      });
  };

  const createButton = (
    <Link className="admin-list__create" to="/settings/users/new">Register User</Link>
  );

  return (
    <AppShell title="Admin — Users" actions={createButton}>
      <AdminTabs />

      {load.status === "loading" && <p role="status">Loading users…</p>}

      {load.status === "error" && <EmptyState headline="Could not load users" body={load.message} />}

      {load.status === "loaded" && load.users.length === 0 && (
        <EmptyState headline="No users yet" body="Register the first user to get started." action={createButton} />
      )}

      {actionError && <p className="admin-list__error" role="alert">{actionError}</p>}

      {load.status === "loaded" && load.users.length > 0 && (
        <section className="admin-list" aria-label="Users">
          {load.users.map((user) => {
            const isSelf = user.id === currentUser.id;
            const siteNames = user.siteIds
              .map((id) => load.sites.find((s) => s.id === id)?.name ?? id)
              .join(", ");

            return (
              <div key={user.id} className="card admin-list__card">
                <div className="admin-list__row">
                  <div>
                    <p className="admin-list__title">{user.displayName}</p>
                    <p className="admin-list__meta">
                      {user.username} · <span className={`pill pill--attribute admin-list__status-${user.status.toLowerCase()}`}>{user.status}</span>
                    </p>
                    {/* Registering by email sets username = email server-side (US-30) — showing
                        both lines here would just repeat the same address twice. */}
                    {user.email && user.email !== user.username && (
                      <p className="admin-list__meta">{user.email}</p>
                    )}
                    <p className="admin-list__meta">{siteNames || "No sites assigned"}</p>
                  </div>

                  <div className="admin-list__actions">
                    <label className="admin-list__inline-field">
                      Role
                      <select
                        value={user.role}
                        disabled={isSelf}
                        onChange={(e) => patchUser(user.id, { role: e.target.value as Role })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{roleLabel(r)}</option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() =>
                        patchUser(user.id, { status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
                      }
                    >
                      {user.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingSitesId(editingSitesId === user.id ? null : user.id)}
                    >
                      {editingSitesId === user.id ? "Done" : "Edit Sites"}
                    </button>
                  </div>
                </div>

                {isSelf && (
                  <p className="admin-list__hint">
                    You cannot change your own role or status — ask another admin.
                  </p>
                )}

                {editingSitesId === user.id && (
                  <SiteMembershipEditor
                    user={user}
                    sites={load.sites.filter((s) => !s.archived)}
                    onChanged={(siteIds) => replaceUser({ ...user, siteIds })}
                  />
                )}
              </div>
            );
          })}
        </section>
      )}
    </AppShell>
  );
}
