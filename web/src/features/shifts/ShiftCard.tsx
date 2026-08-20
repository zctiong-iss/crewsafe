/** @author Tang Chee Seng (with assistance from Claude & Gemini) */
import { useEffect, useMemo, useState } from "react";
import type { Shift, Intensity } from "@/api/shifts";
import { formatShiftRange } from "./formatShiftRange";
import { Link } from "react-router-dom";
import { generateRecommendation } from "@/api/approvals";
import { ApiError, messageFor } from "@/api/errors";
import { displayStatus, type DisplayStatus } from "./shiftDisplayStatus";


const STATUS_LABEL: Record<DisplayStatus, string> = {
  PLANNED: "Planned", ACTIVE: "Active", ENDED: "Ended", CLOSED: "Closed", CANCELLED: "Cancelled",
};

function StatusPill({ status }: Readonly<{ status: DisplayStatus }>) {
  return <span className={`pill pill--status pill--${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

function IntensityPill({ intensity }: Readonly<{ intensity: Intensity }>) {
  const label = intensity.charAt(0) + intensity.slice(1).toLowerCase();
  return <span className={`pill pill--intensity pill--intensity-${intensity.toLowerCase()}`}>{label}</span>;
}

type DraftPlan =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "generated"; recommendationId: string }
  | { status: "error"; message: string };

const GENERATING = "generating" as const;

export function ShiftCard({ shift, workerNames, siteNames, currentUserId, crewScope = "all", canManage = false, now = new Date() }: Readonly<{
  shift: Shift;
  workerNames: Map<string, string>;
  siteNames: Map<string, string>;
  currentUserId?: string;
  crewScope?: "all" | "self";
  /** Show the Edit entry point. Management-only; the route is MANAGEMENT_ROLES-guarded. */
  canManage?: boolean;
  now?: Date;
}>) {

  const isAssigned = Boolean(currentUserId && shift.assignments.some((a) => a.workerId === currentUserId));
  const [open, setOpen] = useState(isAssigned);
  const count = shift.assignments.length;   // the headcount stays whole even when the table does not
  const siteName = siteNames.get(shift.siteId);
  const status = displayStatus(shift, now);
  // Matches the backend's assertEditable (SCRUM-266): a CLOSED/CANCELLED shift, OR one whose end time
  // has already passed, cannot be edited — so don't offer Edit for it (every mutation would 400).
  const editable =
    (shift.status === "PLANNED" || shift.status === "ACTIVE") && new Date(shift.endsAt) > now;

  const [draftPlan, setDraftPlan] = useState<DraftPlan>({ status: "idle" });
  const onDraftPlan = () => {
    setDraftPlan({ status: GENERATING });
    generateRecommendation(shift.siteId, shift.id)
      .then((recommendation) => setDraftPlan({ status: "generated", recommendationId: recommendation.id }))
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setDraftPlan({ status: "error", message: messageFor(apiError) });
      });
  };

  const crew = useMemo(
    () => (crewScope === "self"
      ? shift.assignments.filter((a) => a.workerId === currentUserId)
      : shift.assignments),
    [shift.assignments, crewScope, currentUserId],
  );

// In the event that an assignment points at a worker not in the roster, the issue will be surfaced as an effect on the page.
// Scoped to the rows actually rendered: a worker holds only their own name, so checking the
// whole shift would raise a data-integrity alarm on every healthy colleague.
useEffect(() => {
  if (!import.meta.env.DEV) return;
  const missing = crew.filter((a) => !workerNames.has(a.workerId));
  if (missing.length > 0) {
    console.warn(`ShiftCard ${shift.id}: ${missing.length} assignment(s) reference worker(s) missing from the roster`,
      missing.map((a) => a.workerId));
  }
}, [shift.id, crew, workerNames]);

  return (
   <article className={`shift-card shift-card--${status.toLowerCase()}${open ? " shift-card--open" : ""} card`}>
      <div className="shift-card__summary">
      <header className="shift-card__header">
        <div>
          {siteName && <p className="shift-card__site">{siteName}</p>}   {/* + eyebrow */}
          <p className="shift-card__range">{formatShiftRange(shift.startsAt, shift.endsAt)}</p>
          <p className="shift-card__count">{count} {count === 1 ? "worker" : "workers"}</p>
        </div>
            <div className="shift-card__pills">
            {isAssigned && <span className="pill pill--assigned">Your Shift</span>}
            <StatusPill status={status} />
            {canManage && editable && (
              <Link className="shift-card__edit" to={`/shifts/${shift.id}/edit`} state={{ shift }}>
                Edit
              </Link>
            )}
            {/* Close-out summary (US-44): the defensible end-of-shift record, offered once a shift
                has been formally closed. Same management audience as Edit; the route is guarded. */}
            {canManage && shift.status === "CLOSED" && (
              <Link className="shift-card__summary-link" to={`/shifts/${shift.id}/summary`} state={{ shift }}>
                Close-out summary
              </Link>
            )}
            {canManage && editable && (
              <button
                type="button"
                className="shift-card__draft-plan"
                disabled={draftPlan.status === GENERATING}
                onClick={onDraftPlan}
              >
                {draftPlan.status === GENERATING ? "Drafting…" : "Draft Plan"}
              </button>
            )}
        </div>
      </header>

      {draftPlan.status === "generated" && (
        <output className="shift-card__draft-plan-note">
          Plan drafted — <Link to="/approvals">review it in Approvals</Link>.
        </output>
      )}
      {draftPlan.status === "error" && (
        <p className="shift-card__draft-plan-note shift-card__draft-plan-note--error" role="alert">
          {draftPlan.message}
        </p>
      )}

      {count > 0 && (
        <button
          type="button"
          className="shift-card__disclosure"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide crew" : "Show crew"}
        </button>
      )}
      </div>

        {open && (
        <div className="shift-card__crew-wrapper">
          <table className="shift-card__crew">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Intensity</th>
                <th>Task</th>
                <th>Acclimatisation Day</th>
              </tr>
            </thead>
            <tbody>
              {crew.map((a) => {
                const workerName = workerNames.get(a.workerId);
                const isCurrent = currentUserId && a.workerId === currentUserId;
                return (
                  <tr key={a.id} className={isCurrent ? "shift-card__row--current-user" : undefined}>
                    <td className={workerName ? undefined : "shift-card__worker--missing"}>
                      {workerName ?? "Worker not found"} {isCurrent && "(You)"}
                    </td>
                    <td><IntensityPill intensity={a.intensity} /></td>
                    <td className="shift-card__task">{a.taskName ?? "—"}</td>
                    <td className="shift-card__accl">{a.acclimatisationDay ?? "NIL"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
