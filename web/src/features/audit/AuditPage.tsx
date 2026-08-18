/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { fetchAccessibleSites, type Site } from "@/api/identity";
import { fetchAuditPage, downloadAuditCsv, type AuditPage as AuditPageData } from "@/api/audit";
import { saveBlob } from "./downloadBlob";
import { ApiError, messageFor } from "@/api/errors";
import { AuditTable } from "./AuditTable";
import "./AuditPage.css";

type Load =
  | { status: "loading" }
  | { status: "loaded"; data: AuditPageData }
  | { status: "error"; message: string; requestId: string | null };

// A fixed 7-day window keeps the first cut simple; a full range picker is a follow-up.
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function AuditPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [range] = useState(defaultRange);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    fetchAccessibleSites()
      .then((list) => {
        if (!active) return;
        setSites(list);
        setSiteId((current) => current ?? list[0]?.id ?? null); // ?? (S6606)
      })
      .catch(() => active && setSites([]));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (siteId === null) return;
    let active = true;
    setLoad({ status: "loading" });
    fetchAuditPage(siteId, range.from, range.to, page)
      .then((data) => active && setLoad({ status: "loaded", data }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => {
      active = false;
    };
  }, [siteId, range.from, range.to, page]);

  async function onDownload() {
    if (siteId === null) return;
    setDownloading(true);
    try {
      const { blob, filename } = await downloadAuditCsv(siteId, range.from, range.to);
      saveBlob(blob, filename);
    } catch {
      // A failed download must not wedge the button. The table already shows the data; re-enabling
      // and letting them retry is the honest minimum until a toast system exists.
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AppShell
      title="Audit Trail"
      subtitle="A faithful copy of the append-only record"
      actions={
        <button
          type="button"
          className="audit__download"
          onClick={() => void onDownload()}
          disabled={siteId === null || downloading}
        >
          {downloading ? "Preparing…" : "Download CSV"}
        </button>
      }
    >
      {sites.length > 1 && (
        <label className="audit__site-picker">
          <span>Site</span>
          <select
            value={siteId ?? ""}
            onChange={(event) => {
              setSiteId(event.target.value);
              setPage(0);
            }}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {load.status === "loading" && <output className="audit__loading">Loading the audit timeline</output>}

      {load.status === "error" && (
        <EmptyState
          headline="Could not load the audit trail"
          body={
            <>
              {load.message}
              {load.requestId && (
                <>
                  {" "}
                  Reference <span className="code">{load.requestId}</span>.
                </>
              )}
            </>
          }
        />
      )}

      {load.status === "loaded" && load.data.entries.length === 0 && (
        <EmptyState
          headline="No audit events in this range"
          body="Nothing was recorded for this site in the selected period."
        />
      )}

      {load.status === "loaded" && load.data.entries.length > 0 && (
        <AuditTable data={load.data} page={page} onPage={setPage} />
      )}
    </AppShell>
  );
}
