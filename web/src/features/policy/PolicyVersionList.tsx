/**
 * @author Jemilin Beulah
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import {
  activatePolicyVersion, fetchEffectivePolicyVersion, fetchPolicyVersions,
  type EffectivePolicyVersion, type PolicyVersion,
} from "@/api/policy";
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

type DefaultPolicy =
  | { status: "idle" }
  | { status: "loaded"; version: EffectivePolicyVersion }
  | { status: "error" };

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
}

export function PolicyVersionList({ siteId, siteSwitcher }: Readonly<{ siteId: string; siteSwitcher?: ReactNode }>) {
  const user = useCurrentUser();
  const canWrite = user.role === "SAFETY_MANAGER" || user.role === "ADMIN";
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [activate, setActivate] = useState<Activate>({ status: "idle" });
  const [defaultPolicy, setDefaultPolicy] = useState<DefaultPolicy>({ status: "idle" });

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

  // A site with nothing of its own is still governed by the company-wide default
  // (PolicyEngineService's fallback) — fetched only for that case, so a site that has
  // configured its own catalogue never pays for a request it has no use for.
  useEffect(() => {
    if (load.status !== "loaded" || load.versions.length > 0) {
      setDefaultPolicy({ status: "idle" });
      return;
    }
    let active = true;
    fetchEffectivePolicyVersion(siteId)
      .then((version) => active && setDefaultPolicy({ status: "loaded", version }))
      .catch(() => active && setDefaultPolicy({ status: "error" }));
    return () => { active = false; };
  }, [siteId, load]);

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
      {load.status === "loading" && (
        <output style={{ display: "block" }}>Loading policy versions…</output>
      )}

      {load.status === "error" && (
        <EmptyState headline="Could not load policy versions" body={load.message} />
      )}

      {load.status === "loaded" && load.versions.length === 0 && (
        <div className="policy-list">
          {defaultPolicy.status === "loaded" && (
            <section aria-label="Default policy in effect">
              <p className="policy-list__default-heading">
                Recommendations for this site are governed by this default until one is configured:
              </p>
              <PolicyVersionCard
                version={defaultPolicy.version}
                activeVersion={null}
                canWrite={false}
                isActivating={false}
                onActivate={() => {}}
              />
            </section>
          )}
        </div>
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
