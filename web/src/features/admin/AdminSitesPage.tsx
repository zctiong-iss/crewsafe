/**
 * @author Jemilin Beulah
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { archiveSite, fetchAdminSites, unarchiveSite, type AdminSite } from "@/api/admin";
import { AdminTabs } from "./AdminTabs";
import { SiteForm } from "./SiteForm";
import "./Admin.css";

type Load =
  | { status: "loading" }
  | { status: "loaded"; sites: AdminSite[] }
  | { status: "error"; message: string; requestId: string | null };

export function AdminSitesPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAdminSites()
      .then((sites) => active && setLoad({ status: "loaded", sites }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => {
      active = false;
    };
  }, []);

  const replaceSite = (updated: AdminSite) => {
    setLoad((current) =>
      current.status === "loaded"
        ? { status: "loaded", sites: current.sites.map((s) => (s.id === updated.id ? updated : s)) }
        : current,
    );
  };

  const toggleArchive = (site: AdminSite) => {
    setActionError(null);
    const request = site.archived ? unarchiveSite(site.id) : archiveSite(site.id);
    request
      .then((updated) => {
        replaceSite(updated);
        setConfirmingId(null);
      })
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setActionError(messageFor(apiError));
      });
  };

  const createButton = (
    <Link className="admin-list__create" to="/settings/sites/new">Create Site</Link>
  );

  return (
    <AppShell title="Admin — Sites" actions={createButton}>
      <AdminTabs />

      {load.status === "loading" && <output style={{ display: "block" }}>Loading sites…</output>}

      {load.status === "error" && <EmptyState headline="Could not load sites" body={load.message} />}

      {load.status === "loaded" && load.sites.length === 0 && (
        <EmptyState headline="No sites yet" body="Create the first site to get started." action={createButton} />
      )}

      {actionError && <p className="admin-list__error" role="alert">{actionError}</p>}

      {load.status === "loaded" && load.sites.length > 0 && (
        <section className="admin-list" aria-label="Sites">
          {load.sites.map((site) =>
            editingId === site.id ? (
              <div key={site.id} className="card admin-list__card">
                <SiteForm
                  mode="edit"
                  site={site}
                  onSaved={(updated) => {
                    replaceSite(updated);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div key={site.id} className="card admin-list__card">
                <div className="admin-list__row">
                  <div>
                    <p className="admin-list__title">
                      {site.name}
                      {site.archived && <span className="pill pill--attribute admin-list__badge">Archived</span>}
                    </p>
                    <p className="admin-list__meta">{site.latitude}, {site.longitude}</p>
                  </div>
                  <div className="admin-list__actions">
                    <button type="button" onClick={() => setEditingId(site.id)}>Edit</button>
                    {confirmingId === site.id ? (
                      <span className="admin-list__confirm">
                        {site.archived ? "Unarchive this site?" : "Archive this site?"}
                        <button type="button" onClick={() => toggleArchive(site)}>Confirm</button>
                        <button type="button" onClick={() => setConfirmingId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmingId(site.id)}>
                        {site.archived ? "Unarchive" : "Archive"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ),
          )}
        </section>
      )}
    </AppShell>
  );
}
