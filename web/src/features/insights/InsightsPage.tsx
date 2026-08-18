/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { fetchAccessibleSites, type Site } from "@/api/identity";
import { fetchComplianceReport, type ComplianceReport } from "@/api/insights";
import { ApiError, messageFor } from "@/api/errors";
import { ComplianceChart } from "./ComplianceChart";
import { ResponseTimeChart } from "./ResponseTimeChart";
import { FallbackStatusPanel } from "./FallbackStatusPanel";
import { ForecastAccuracyPanel } from "./ForecastAccuracyPanel";
import "./InsightsPage.css";

// Same Load-union shape as HomePage — a total union so every branch is handled and
// "loading" can never be confused with "loaded but empty".
type Load =
  | { status: "loading" }
  | { status: "loaded"; report: ComplianceReport }
  | { status: "error"; message: string; requestId: string | null };

// A fixed 7-day window keeps the first cut simple; a full range picker is a follow-up.
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// Percent + "no data yet" as a lookup-free single expression — null means no dispatched actions,
// not zero compliance, and the two must read differently (S3358: no nested ternary).
function ratePercent(report: ComplianceReport): string {
  if (report.dispatched === 0) return "—";
  return `${Math.round(report.complianceRate * 100)}%`;
}

function seconds(value: number | null): string {
  return value === null ? "—" : `${value}s`;
}

export function InsightsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [range] = useState(defaultRange);

  // First effect: which sites may this manager pick? Default to the first.
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

  // Second effect: load the report whenever the chosen site changes.
  useEffect(() => {
    if (siteId === null) return;
    let active = true;
    setLoad({ status: "loading" });
    fetchComplianceReport(siteId, range.from, range.to)
      .then((report) => active && setLoad({ status: "loaded", report }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => {
      active = false;
    };
  }, [siteId, range.from, range.to]);

  return (
    <AppShell title="Insights" subtitle="Compliance & response time">
      {sites.length > 1 && (
        <label className="insights__site-picker">
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

      {siteId === null && sites.length === 0 && (
        <EmptyState
          headline="No sites to report on"
          body="You are not assigned to a site yet, so there is nothing to summarise."
        />
      )}

      {load.status === "loading" && siteId !== null && (
        <output className="insights__loading">Loading the compliance report</output>
      )}

      {load.status === "error" && (
        <EmptyState
          headline="Could not load the report"
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

      {load.status === "loaded" && siteId !== null && (
        <>
          <ReportView report={load.report} />

          {/* SCRUM-434 forecast panels: fallback status is per-site (takes the chosen siteId);
              model accuracy is global (takes nothing). Both consume already-shipped endpoints. */}
          <section className="insights__panel" aria-label="Forecast fallback status">
            <h2 className="insights__panel-title">Is the forecast running degraded?</h2>
            <FallbackStatusPanel siteId={siteId} />
          </section>

          <section className="insights__panel" aria-label="Model accuracy">
            <h2 className="insights__panel-title">How accurate is the forecast model?</h2>
            <ForecastAccuracyPanel />
          </section>
        </>
      )}
    </AppShell>
  );
}

// Split out so InsightsPage stays a thin router of states (keeps each function's complexity
// low — S3776 — and lets 434's forecast panels mount beside <ReportView> later).
function ReportView({ report }: Readonly<{ report: ComplianceReport }>) {
  return (
    <>
      <section className="insights__stats" aria-label="Headline metrics">
        <Stat label="Compliance rate" value={ratePercent(report)} />
        <Stat label="Actions dispatched" value={`${report.dispatched}`} />
        <Stat label="Response time (p95)" value={seconds(report.p95ResponseSeconds)} />
      </section>

      <section className="insights__panel" aria-label="Compliance over time">
        <h2 className="insights__panel-title">Were heat actions acted on?</h2>
        <ComplianceChart buckets={report.compliance} />
      </section>

      <section className="insights__panel" aria-label="Response-time distribution">
        <h2 className="insights__panel-title">How fast were they acknowledged?</h2>
        <ResponseTimeChart buckets={report.responseTimes} />
      </section>

      {/* The accessible, exact-number alternative to both charts. Visually hidden but read by
          screen readers AND asserted by the test — the "colour-blind-safe" + "verified against
          seeded values" criterion in one element. */}
      <table className="visually-hidden">
        <caption>Compliance by day and response-time distribution</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Dispatched</th>
            <th scope="col">Acted on</th>
            <th scope="col">Lapsed</th>
          </tr>
        </thead>
        <tbody>
          {report.compliance.map((bucket) => (
            <tr key={bucket.label}>
              <th scope="row">{bucket.label}</th>
              <td>{bucket.dispatched}</td>
              <td>{bucket.actedOn}</td>
              <td>{bucket.lapsed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="insights__stat card">
      <span className="eyebrow">{label}</span>
      <span className="insights__stat-value">{value}</span>
    </div>
  );
}
