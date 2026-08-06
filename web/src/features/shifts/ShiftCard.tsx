/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
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

export function ShiftCard({ shift, workerNames, siteNames }: {
  shift: Shift;
  workerNames: Map<string, string>;
  siteNames: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const count = shift.assignments.length;
  const siteName = siteNames.get(shift.siteId);

// In the event that an assignment points at a worker not in the roster, the issue will be surfaced as an effect on the page.
useEffect(() => {
  const missing = shift.assignments.filter((a) => !workerNames.has(a.workerId));
  if (missing.length > 0) {
    console.warn(
      `ShiftCard ${shift.id}: ${missing.length} assignment(s) has worker(s) that are missing from the roster`,
      missing.map((a) => a.workerId),
    );
  }
}, [shift, workerNames]);

  return (
    <article className={`shift-card shift-card--${shift.status.toLowerCase()} card`}>
      <header className="shift-card__header">
        <div>
          {siteName && <p className="shift-card__site">{siteName}</p>}   {/* + eyebrow */}
          <p className="shift-card__range">{formatShiftRange(shift.startsAt, shift.endsAt)}</p>
          <p className="shift-card__count">{count} {count === 1 ? "worker" : "workers"}</p>
        </div>
        <StatusPill status={shift.status} />
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

        {open && (
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
      {shift.assignments.map((a) => {
        const workerName = workerNames.get(a.workerId);
        return (
          <tr key={a.id}>
            <td className={workerName ? undefined : "shift-card__worker--missing"}>
              {workerName ?? "Worker not found"}
            </td>
            <td><IntensityPill intensity={a.intensity} /></td>
            <td className="shift-card__task">{a.taskName ?? "—"}</td>
            <td className="shift-card__accl">{a.acclimatisationDay ?? "NIL"}</td>
          </tr>
        );
      })}
    </tbody>
  </table>
)}
    </article>
  );
}