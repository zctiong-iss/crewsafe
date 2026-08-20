/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { fetchAccessibleSites, type Site } from "@/api/identity";
import { fetchReadinessSummary, type SiteReadinessSummary } from "@/api/readiness";
import { ApiError, messageFor } from "@/api/errors";
import { ShiftReadinessCard } from "./ShiftReadinessCard";
import "./ReadinessPage.css";

// Same Load-union shape as HomePage — a total union so every branch is handled and
// "loading" can never be confused with "loaded but empty".
type Load =
  | { status: "loading" }
  | { status: "loaded"; summary: SiteReadinessSummary }
  | { status: "error"; message: string; requestId: string | null };

export function ReadinessPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });

  // First effect: which sites may this supervisor pick? Default to the first.
  useEffect(() => {
    let active = true;
    fetchAccessibleSites()
      .then((list) => {
        if (!active) return;
        setSites(list);
        setSiteId((current) => current ?? list[0]?.id ?? null); // ?? not || (S6606)
      })
      .catch(() => active && setSites([]));
    return () => {
      active = false;
    };
  }, []);

  // Second effect: load the summary whenever the chosen site changes.
  useEffect(() => {
    if (siteId === null) return;
    let active = true;
    setLoad({ status: "loading" });
    fetchReadinessSummary(siteId)
      .then((summary) => active && setLoad({ status: "loaded", summary }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  return (
    <AppShell title="Team Readiness" subtitle="Who is shift-ready before the shift begins">
      {sites.length > 1 && (
        <label className="readiness__site-picker">
          <span>Site</span>
          <select value={siteId ?? ""} onChange={(event) => setSiteId(event.target.value)}>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {load.status === "loading" && siteId !== null && (
        <output className="readiness__loading">Loading team readiness</output>
      )}

      {load.status === "error" && (
        <EmptyState
          headline="Could not load team readiness"
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

      {load.status === "loaded" && load.summary.shifts.length === 0 && (
        <EmptyState
          headline="No upcoming shifts"
          body="There are no planned or active shifts to check team readiness for at this site."
        />
      )}

      {load.status === "loaded" && load.summary.shifts.length > 0 && (
        <section className="readiness__shifts" aria-label="Upcoming shifts">
          {load.summary.shifts.map((shift) => (
            <ShiftReadinessCard key={shift.shiftId} shift={shift} />
          ))}
        </section>
      )}
    </AppShell>
  );
}
