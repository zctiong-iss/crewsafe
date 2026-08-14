/**
 * @author Jemilin Beulah
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { activatePolicyVersion, fetchPolicyVersions, type PolicyVersion } from "@/api/policy";
import { useCurrentUser } from "@/auth/useAuth";
import { PolicyVersionCard } from "./PolicyVersionCard";
import "./PolicyVersionList.css";

type Load =
  | { status: "loading" }
  | { status: "loaded"; versions: PolicyVersion[] }
  | { status: "error"; message: string; requestId: string | null };

type Activate =
  | { status: "idle" }
  | { status: "activating"; versionId: string }
  | { status: "error"; message: string; requestId: string | null };

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
}

export function PolicyVersionList({ siteId, siteSwitcher }: { siteId: string; siteSwitcher?: ReactNode }) {
  const user = useCurrentUser();
  const canWrite = user.role === "SAFETY_MANAGER" || user.role === "ADMIN";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [activate, setActivate] = useState<Activate>({ status: "idle" });

  useEffect(() => {
    let active = true;
    fetchPolicyVersions(siteId)
      .then((versions) => active && setLoad({ status: "loaded", versions }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError = toApiError(error);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => { active = false; };
  }, [siteId]);

  const refetch = () => {
    fetchPolicyVersions(siteId)
      .then((versions) => setLoad({ status: "loaded", versions }))
      .catch((error: unknown) => {
        const apiError = toApiError(error);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
  };

  const handleActivate = (versionId: string) => {
    setActivate({ status: "activating", versionId });
    activatePolicyVersion(siteId, versionId)
      .then(() => {
        setActivate({ status: "idle" });
        refetch();
      })
      .catch((error: unknown) => {
        const apiError = toApiError(error);
        setActivate({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
  };

  const createButton = canWrite ? (
    <Link className="policy-list__create" to="/policy/new">Create New Version</Link>
  ) : null;

  return (
    <AppShell title="Heat Policy" siteSwitcher={siteSwitcher} actions={createButton}>
      {load.status === "loading" && <p role="status">Loading policy versions…</p>}

      {load.status === "error" && (
        <EmptyState headline="Could not load policy versions" body={load.message} />
      )}

      {load.status === "loaded" && load.versions.length === 0 && (
        <EmptyState
          headline="No policy versions yet"
          body={canWrite
            ? "Configure the site's first heat policy version to get started."
            : "No heat policy has been configured for this site yet. Ask your safety manager."}
          action={createButton}
        />
      )}

      {load.status === "loaded" && load.versions.length > 0 && (() => {
        const activeVersion = load.versions.find((v) => v.status === "ACTIVE") ?? null;
        return (
          <>
            {activate.status === "error" && (
              <p className="policy-list__error" role="alert">
                {activate.message}
                {activate.requestId && <> Reference <span className="code">{activate.requestId}</span>.</>}
              </p>
            )}
            <section className="policy-list" aria-label="Policy versions">
              {load.versions.map((version) => (
                <PolicyVersionCard
                  key={version.id}
                  version={version}
                  activeVersion={activeVersion}
                  canWrite={canWrite}
                  isActivating={activate.status === "activating" && activate.versionId === version.id}
                  onActivate={handleActivate}
                />
              ))}
            </section>
          </>
        );
      })()}
    </AppShell>
  );
}
