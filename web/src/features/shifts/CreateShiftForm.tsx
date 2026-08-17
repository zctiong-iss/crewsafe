/** @author Jemilin Beulah, Tang Chee Seng */

import { useEffect, useState, type SyntheticEvent } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
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
import { Link } from "react-router-dom";
import { type Site } from "@/api/identity";
import { useSelectedSite } from "@/site/useSelectedSite";

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

export function CreateShiftForm({ sites }: { sites: Site[] }) {
  const { siteId: currentSiteId } = useSelectedSite();
  const [workersLoad, setWorkersLoad] = useState<WorkersLoad>({ status: "loading" });
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [endsAt, setEndsAt] = useState<Date | null>(null);
  const [siteId, setSiteId] = useState(currentSiteId ?? sites[0]?.id ?? "");
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
    startsAt: startsAt!.toISOString(),
    endsAt: endsAt!.toISOString(),
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

  const handleSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    const body = buildBody();
    const found = validateShift(body);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmit({ status: "submitting" });
    createShift(siteId, body)
      .then((shift) => setSubmit({ status: "created", shift }))
      .catch((error: unknown) => {
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
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
      <AppShell title="Create Shift" >
        <EmptyState headline="Shift created" body={`Shift ${submit.shift.id} is ${submit.shift.status}.`}
          action={<Link to="/shifts" className="NavButton"> Back to Shifts Page</Link>} />
      </AppShell>
    );
  }

  const noWorkers = workersLoad.workers.length === 0;

  return (
    <AppShell title="Create Shift" >
      <form className="shift-form" onSubmit={handleSubmit}>
        <section className="shift-form__section">
        <h2 className="shift-form__section-title">Shift Details</h2>
          <label htmlFor="siteId">Worksite</label>
          <select
            id="siteId"
            required
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setRows([]);
              setWorkersLoad({ status: "loading" });
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <label htmlFor="startsAt">Starts at</label>
          <DatePicker
            id="startsAt"
            wrapperClassName="shift-form__datepicker-wrapper"
            className="shift-form__datepicker-input"
            selected={startsAt}
            onChange={setStartsAt}
            showTimeSelect
            timeFormat="HH:mm"
            timeIntervals={15}
            dateFormat="d MMM yyyy, HH:mm"
            required
          />

          <label htmlFor="endsAt">Ends at</label>
          <DatePicker
            id="endsAt"
            wrapperClassName="shift-form__datepicker-wrapper"
            className="shift-form__datepicker-input"
            selected={endsAt}
            onChange={setEndsAt}
            showTimeSelect
            timeFormat="HH:mm"
            timeIntervals={15}
            dateFormat="d MMM yyyy, HH:mm"
            required
          />
          {errors.endsAt && <p className="shift-form__error" role="alert">{errors.endsAt}</p>}
        </section>

        <section className="shift-form__section">
        <h2 className="shift-form__section-title">Crew Assigned</h2>
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

              <label htmlFor={`accl-${i}`}>Acclimatisation Days (if applicable)</label>
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

          {noWorkers && (
            <p className="shift-form__note" role="status">
              No workers are assigned to this worksite yet. You can still create the shift and staff it later.
            </p>
          )}
          {!noWorkers && (
            <button type="button" onClick={addRow}>Add worker</button>
          )}
        </section>

        {!noWorkers && rows.length === 0 && (
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

        <div className="shift-form__actions">
          <Link className="shift-form__back" to="/shifts">Cancel</Link>

          <button type="submit" disabled={submit.status === "submitting"}>
            {submit.status === "submitting" ? "Creating…" : "Create Shift"}
          </button>
        </div>

      </form>
    </AppShell>
  );
}