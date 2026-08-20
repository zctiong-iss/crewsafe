/** @author Tang Chee Seng (with assistance from Claude) */
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { SitePlanCard } from "./SitePlanCard";
import { fetchPlanSummary, type SitePlanSummary } from "@/api/oversight";
import { fetchAccessibleSites } from "@/api/identity";
import { ApiError, messageFor } from "@/api/errors";
import "./OversightPage.css";

type Load =
  | { status: "loading" }
  | { status: "loaded"; sites: SitePlanSummary[] }
  | { status: "error"; message: string; requestId: string | null };

// A safety manager may hold twenty memberships; this polls the one collapsed endpoint rather
// than making them expand every site to see whether a plan is waiting. 30s keeps a stale
// count on screen for at most half a minute without hammering the endpoint every tick.
const REFRESH_MS = 30_000;

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
}

function sortedByAwaitingDecisionDesc(sites: SitePlanSummary[]): SitePlanSummary[] {
  return [...sites].sort((a, b) => b.awaitingDecision - a.awaitingDecision);
}

/**
 * Cross-site oversight board for the safety manager (US-37).
 *
 * Every site the caller belongs to, sorted so the site with the most plans awaiting a
 * decision leads — the figure this screen exists to surface. Refreshes on a 30s interval so
 * a manager who leaves the tab open sees an outstanding plan land without a manual refresh,
 * but a hidden tab is not worth the request: the poll skips its tick while backgrounded and
 * simply picks back up once the tab is visible again.
 */
export function OversightPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // siteId → human name. Plan-summary carries only a siteId, so names are resolved from the
  // accessible-sites list (the same source HomePage and Readiness use). Fetched once — site
  // names are stable — and defaulted to {} so a card falls back to the id if a name is missing.
  const [siteNames, setSiteNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetchAccessibleSites()
      .then((sites) => {
        if (!active) return;
        setSiteNames(Object.fromEntries(sites.map((site) => [site.id, site.name])));
      })
      .catch(() => {
        // A failed name lookup is not worth failing the board over — the cards fall back to
        // the site id, which is worse to read but still correct. The counts are the point.
      });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback((background: boolean) => {
    if (background && document.hidden) return;

    fetchPlanSummary()
      .then((sites) => setLoad({ status: "loaded", sites: sortedByAwaitingDecisionDesc(sites) }))
      .catch((error: unknown) => {
        // A quiet background refresh failing keeps the last good board on screen rather than
        // replacing it with an error state a manager would have to dismiss mid-shift.
        if (background) return;
        const apiError = toApiError(error);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
  }, []);

  useEffect(() => {
    refresh(false);
    const id = setInterval(() => refresh(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <AppShell title="Oversight" subtitle="Plans awaiting a decision, across every site you oversee">
      {load.status === "loading" && (
        <output className="oversight__loading">Loading your sites</output>
      )}

      {load.status === "error" && (
        <EmptyState
          headline="Could not load oversight data"
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

      {load.status === "loaded" && load.sites.length === 0 && (
        <EmptyState
          headline="No sites under your oversight"
          body="You are not currently a member of any site. Your site administrator assigns oversight — once that is done, sites appear here."
        />
      )}

      {load.status === "loaded" && load.sites.length > 0 && (
        <section className="oversight__sites" aria-label="Sites under your oversight">
          {load.sites.map((summary) => (
            <SitePlanCard
              key={summary.siteId}
              summary={summary}
              siteName={siteNames[summary.siteId] ?? summary.siteId}
            />
          ))}
        </section>
      )}
    </AppShell>
  );
}
