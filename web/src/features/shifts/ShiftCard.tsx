/** @author Tang Chee Seng (with assistance from Claude & Gemini) */
import { useEffect, useMemo, useState } from "react";
import type { Shift, Intensity } from "@/api/shifts";
import { formatShiftRange } from "./formatShiftRange";

const STATUS_LABEL: Record<Shift["status"], string> = {
  PLANNED: "Planned", ACTIVE: "Active", CLOSED: "Closed",
};

function StatusPill({ status }: { status: Shift["status"] }) {
  return <span className={`pill pill--status pill--${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

function IntensityPill({ intensity }: { intensity: Intensity }) {
  const label = intensity.charAt(0) + intensity.slice(1).toLowerCase();
  return <span className={`pill pill--intensity pill--intensity-${intensity.toLowerCase()}`}>{label}</span>;
}

export function ShiftCard({ shift, workerNames, siteNames, currentUserId, crewScope = "all" }: {
  shift: Shift;
  workerNames: Map<string, string>;
  siteNames: Map<string, string>;
  currentUserId?: string;
  /** "self" scopes the crew table to the reader's own row — a worker may not read the roster. */
  crewScope?: "all" | "self";
}) {
  const isAssigned = Boolean(currentUserId && shift.assignments.some((a) => a.workerId === currentUserId));
  const [open, setOpen] = useState(isAssigned);
  const count = shift.assignments.length;   // the headcount stays whole even when the table does not
  const siteName = siteNames.get(shift.siteId);

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
   <article className={`shift-card shift-card--${shift.status.toLowerCase()}${open ? " shift-card--open" : ""} card`}>
      <div className="shift-card__summary">
      <header className="shift-card__header">
        <div>
          {siteName && <p className="shift-card__site">{siteName}</p>}   {/* + eyebrow */}
          <p className="shift-card__range">{formatShiftRange(shift.startsAt, shift.endsAt)}</p>
          <p className="shift-card__count">{count} {count === 1 ? "worker" : "workers"}</p>
        </div>
        <div className="shift-card__pills">
            {isAssigned && <span className="pill pill--assigned">Your Shift</span>}
            <StatusPill status={shift.status} />
        </div>
      </header>

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
