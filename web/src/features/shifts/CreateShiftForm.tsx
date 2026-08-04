/** @author Tang Chee Seng (with assistance from Claude) */

import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { fetchSiteWorkers, type SiteWorker } from "@/api/workers";
import {
  createShift,
  type Intensity,
  type Shift,
  type ShiftAssignmentCreate,
  type ShiftCreateRequest,
} from "@/api/shifts";
import { validateShift, type FieldErrors } from "./validateShift";
import { WorkIntensitySegmented } from "./WorkIntensitySegmented";
import "./CreateShiftForm.css";

interface AssignmentRow {
  workerId: string;
  intensity: Intensity | "";
  taskName: string;
  acclimatisationDay: string;
}

type WorkersLoad =
  | { status: "loading" }
  | { status: "loaded"; workers: SiteWorker[] }
  | { status: "error"; message: string };

type Submit =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "created"; shift: Shift }
  | { status: "error"; message: string; requestId: string | null };

export function CreateShiftForm({ siteId }: { siteId: string }) {
  const [workersLoad, setWorkersLoad] = useState<WorkersLoad>({ status: "loading" });
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submit, setSubmit] = useState<Submit>({ status: "idle" });

  useEffect(() => {
    let active = true;
    fetchSiteWorkers(siteId)
      .then((list) => active && setWorkersLoad({ status: "loaded", workers: list }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setWorkersLoad({ status: "error", message: messageFor(apiError) });
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  const addRow = () =>
    setRows((prev) => [...prev, { workerId: "", intensity: "", taskName: "", acclimatisationDay: "" }]);
  const removeRow = (index: number) =>
    setRows((prev) => prev.filter((_, i) => i !== index));
  const updateRow = (index: number, patch: Partial<AssignmentRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const buildBody = (): ShiftCreateRequest => ({
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    assignments: rows.map((row) => {
      const assignment: ShiftAssignmentCreate = {
        workerId: row.workerId,
        intensity: row.intensity as Intensity,
      };
      if (row.taskName.trim() !== "") assignment.taskName = row.taskName.trim();
      if (row.acclimatisationDay !== "") assignment.acclimatisationDay = Number(row.acclimatisationDay);
      return assignment;
    }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = buildBody();
    const found = validateShift(body);
    setErrors(found);
    if (Object.keys(found).length > 0) return; // AC-2 / AC-3: a bad draft sends NO request.

    setSubmit({ status: "submitting" });
    createShift(siteId, body)
      .then((shift) => setSubmit({ status: "created", shift })) // AC-1
      .catch((error: unknown) => {
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        // AC-4: stay signed in, keep everything typed (no state reset), show message + id.
        setSubmit({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
  };

  if (workersLoad.status === "loading") {
    return (
      <AppShell title="Create shift">
        <p role="status">Loading workers…</p>
      </AppShell>
    );
  }
  if (workersLoad.status === "error") {
    return (
      <AppShell title="Create shift">
        <EmptyState headline="Could not load workers" body={workersLoad.message} />
      </AppShell>
    );
  }
  if (submit.status === "created") {
    return (
      <AppShell title="Create shift">
        <EmptyState headline="Shift created" body={`Shift ${submit.shift.id} is ${submit.shift.status}.`} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Create shift">
      <form className="shift-form" onSubmit={handleSubmit}>
        <section className="shift-form__section">
        <h2 className="shift-form__section-title">When</h2>
          <label htmlFor="startsAt">Starts at</label>
          <input id="startsAt" type="datetime-local" required value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)} />

          <label htmlFor="endsAt">Ends at</label>
          <input id="endsAt" type="datetime-local" required value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)} />
          {errors.endsAt && <p className="shift-form__error" role="alert">{errors.endsAt}</p>}
        </section>

        <section className="shift-form__section">
        <h2 className="shift-form__section-title">Crew</h2>
          {rows.map((row, i) => (
            <fieldset key={i} className="shift-form__row card">
              <legend>Worker {i + 1}</legend>

              <label htmlFor={`worker-${i}`}>Worker</label>
              <select id={`worker-${i}`} required value={row.workerId}
                onChange={(e) => updateRow(i, { workerId: e.target.value })}>
                <option value="">Select a worker</option>
                {workersLoad.workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.displayName}</option>
                ))}
              </select>

              <WorkIntensitySegmented
                name={`intensity-${i}`}
                value={row.intensity}
                onChange={(next) => updateRow(i, { intensity: next })}
              />

              <label htmlFor={`task-${i}`}>Task (optional)</label>
              <input id={`task-${i}`} type="text" maxLength={120} value={row.taskName}
                onChange={(e) => updateRow(i, { taskName: e.target.value })} />

              <label htmlFor={`accl-${i}`}>Acclimatisation day (optional)</label>
              <input id={`accl-${i}`} type="number" min={1} max={7} value={row.acclimatisationDay}
                onChange={(e) => updateRow(i, { acclimatisationDay: e.target.value })} />
              {errors[`assignments.${i}.acclimatisationDay`] && (
                <p className="shift-form__error" role="alert">
                  {errors[`assignments.${i}.acclimatisationDay`]}
                </p>
              )}

              <button type="button" onClick={() => removeRow(i)}>Remove worker</button>
            </fieldset>
          ))}

          <button type="button" onClick={addRow}>Add worker</button>
        </section>


        {rows.length === 0 && (
          <p className="shift-form__note">
            No workers assigned — you can add them after creating the shift.
          </p>
        )}

        {submit.status === "error" && (
          <p className="shift-form__error" role="alert">
            {submit.message}
            {submit.requestId && <> Reference <span className="code">{submit.requestId}</span>.</>}
          </p>
        )}

        <button type="submit" disabled={submit.status === "submitting"}>
          {submit.status === "submitting" ? "Creating…" : "Create shift"}
        </button>
      </form>
    </AppShell>
  );
}