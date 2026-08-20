/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import type { Shift } from "@/api/shifts";
import type { WbgtBand } from "@/api/conditionsStream";
import { fetchShiftSummary, downloadShiftSummaryCsv, type ShiftCloseSummary } from "@/api/shiftSummary";
import { saveBlob } from "@/features/audit/downloadBlob";
import { ApiError, messageFor } from "@/api/errors";
import "./ShiftCloseOutSummary.css";

/**
 * Band → label / tone, DISPLAY ONLY (the band arrives already classified by the server). Kept in
 * sync with {@code SiteConditionsSummary}'s maps; a total Record over the union makes a new band a
 * compile error rather than a blank cell.
 */
const BAND_LABEL: Record<WbgtBand, string> = {
  BELOW_31: "Low Heat Risk · <31 °C",
  "31_TO_BELOW_32": "Elevated Heat Risk · 31–32 °C",
  "32_TO_BELOW_33": "High Heat Risk · 32–33 °C",
  "33_AND_ABOVE": "Extreme Heat Risk · 33 °C+",
};
const BAND_TONE: Record<WbgtBand, "low" | "moderate" | "high" | "extreme"> = {
  BELOW_31: "low",
  "31_TO_BELOW_32": "moderate",
  "32_TO_BELOW_33": "high",
  "33_AND_ABOVE": "extreme",
};

type Load =
  | { status: "loading" }
  | { status: "loaded"; data: ShiftCloseSummary }
  | { status: "error"; message: string; requestId: string | null };

function hasShift(state: unknown): state is { shift: Shift } {
  return typeof state === "object" && state !== null && "shift" in state;
}

export function ShiftCloseOutSummary() {
  const { state } = useLocation();
  const shift = hasShift(state) ? state.shift : null;

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (shift === null) return;
    let active = true;
    setLoad({ status: "loading" });
    fetchShiftSummary(shift.siteId, shift.id)
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
  }, [shift]);

  async function onDownload() {
    if (shift === null) return;
    setDownloading(true);
    try {
      const { blob, filename } = await downloadShiftSummaryCsv(shift.siteId, shift.id);
      saveBlob(blob, filename);
    } catch {
      // A failed download must not wedge the button — re-enable and let them retry.
    } finally {
      setDownloading(false);
    }
  }

  if (shift === null) {
    return (
      <AppShell title="Close-out Summary">
        <EmptyState
          headline="Select a shift from the list to see its close-out summary."
          body="A shift's summary opens from its card on the Shifts page."
          action={<Link to="/shifts">Back to Shifts</Link>}
        />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Close-out Summary"
      subtitle={load.status === "loaded" ? load.data.localRange : undefined}
      actions={
        <button
          type="button"
          className="closeout__download"
          onClick={() => void onDownload()}
          disabled={downloading}
        >
          {downloading ? "Preparing…" : "Download CSV"}
        </button>
      }
    >
      {load.status === "loading" && (
        <output className="closeout__loading">Loading the close-out summary</output>
      )}

      {load.status === "error" && (
        <EmptyState
          headline="Could not load the close-out summary"
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

      {load.status === "loaded" && <SummaryBody data={load.data} />}
    </AppShell>
  );
}

function SummaryBody({ data }: Readonly<{ data: ShiftCloseSummary }>) {
  return (
    <div className="closeout">
      <section className="closeout__header card">
        <p className="closeout__site">{data.siteName}</p>
        <p className="closeout__status">
          Status <span className={`pill pill--status pill--${data.status.toLowerCase()}`}>{data.status}</span>
        </p>
        <p className="closeout__closed">
          {data.closedByName
            ? `Closed by ${data.closedByName}`
            : "Not yet formally closed"}
        </p>
        <p className="closeout__crew">
          {data.workerCount} {data.workerCount === 1 ? "worker" : "workers"} on this shift
        </p>
      </section>

      <section className="closeout__block card" aria-labelledby="closeout-conditions">
        <h2 id="closeout-conditions" className="closeout__block-title">Conditions</h2>
        <dl className="closeout__stats">
          <div className="closeout__stat">
            <dt>Readiness submissions</dt>
            <dd>{data.conditions.readinessSubmissions}</dd>
          </div>
          <div className="closeout__stat">
            <dt>Peak heat</dt>
            <dd>
              {data.conditions.peakBand ? (
                <span className={`pill closeout__band closeout__band--${BAND_TONE[data.conditions.peakBand]}`}>
                  {BAND_LABEL[data.conditions.peakBand]}
                  {data.conditions.peakWbgt !== undefined && ` (${data.conditions.peakWbgt} °C)`}
                </span>
              ) : (
                <span className="closeout__none">No readings in the shift window</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="closeout__block card" aria-labelledby="closeout-actions">
        <h2 id="closeout-actions" className="closeout__block-title">Actions</h2>
        <dl className="closeout__stats closeout__stats--tiles">
          <div className="closeout__stat"><dt>Issued</dt><dd>{data.actions.issued}</dd></div>
          <div className="closeout__stat"><dt>Acknowledged</dt><dd>{data.actions.acknowledged}</dd></div>
          <div className="closeout__stat"><dt>Completed</dt><dd>{data.actions.completed}</dd></div>
          <div className="closeout__stat closeout__stat--exceptions">
            <dt>Exceptions</dt><dd>{data.actions.exceptions}</dd>
          </div>
        </dl>
      </section>

      <p className="closeout__reconcile">
        Reconciled against {data.totalAuditEvents} audit{" "}
        {data.totalAuditEvents === 1 ? "event" : "events"} for this shift.
      </p>
    </div>
  );
}
