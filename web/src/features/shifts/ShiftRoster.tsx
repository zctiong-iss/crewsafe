/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { ApiError, messageFor } from "@/api/errors";
import {
  addShiftAssignment,
  updateShiftAssignment,
  removeShiftAssignment,
  type Shift,
  type ShiftAssignmentCreate,
  type ShiftAssignmentUpdate,
  type Intensity,
} from "@/api/shifts";
import { fetchSiteWorkers, type SiteWorker } from "@/api/workers";
import { WorkIntensitySegmented } from "./WorkIntensitySegmented";

/** One assignment as it arrives on a Shift — ShiftAssignmentCreate plus the server's id. */
type Assignment = Shift["assignments"][number];

/**
 * This section allows the user to edit the roster. Each add / update goes the server and gets the
 * updated work shift back. As removing a shift returns a 204, we will drop the row from the shifts we
 * already hold.
 *
 * Saving a update to a shift means allowing to edit the following fields - task + intensity + acclimatisation day.
 * This is because the server's `correct()` function REPLACES all three. A partial update of the fields would wipe the field(s) that were left out.
 *
 * Swap a worker = remove the worker first, then add a new worker with the replacement. 
 * This is consistent with the deliberate choice of having no in-place workerId change (docs/api/shift.yaml).
 */

export function ShiftRoster({
  shift,
  onShiftChange,
}: Readonly<{
  shift: Shift;
  onShiftChange: (shift: Shift) => void;
}>) {
  const [workers, setWorkers] = useState<SiteWorker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchSiteWorkers(shift.siteId).then(setWorkers).catch(() => setWorkers([]));
  }, [shift.siteId]);

  const nameById = useMemo(
    () => new Map(workers.map((w) => [w.id, w.displayName])),
    [workers],
  );

  const fail = (e: unknown) =>
    setError(messageFor(e instanceof ApiError ? e : new ApiError("server", "Unknown", null, null)));

  function handleAdd(body: ShiftAssignmentCreate) {
    setBusy(true);
    setError(null);
    addShiftAssignment(shift.siteId, shift.id, body)
      .then(onShiftChange) // POST returns the full shift.
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function handleSave(assignmentId: string, body: ShiftAssignmentUpdate) {
    setBusy(true);
    setError(null);
    updateShiftAssignment(shift.siteId, shift.id, assignmentId, body)
      .then(onShiftChange) // PATCH returns the full shift too.
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function handleRemove(assignmentId: string) {
    setBusy(true);
    setError(null);
    removeShiftAssignment(shift.siteId, shift.id, assignmentId)
        .then(() =>
            // Returns 204 with no shift body. Rebuilds the list from the last copy that was held, excluding the deleted row.
            onShiftChange({
                ...shift,
                assignments: shift.assignments.filter((a) => a.id !== assignmentId),
            }),
        )
        .catch(fail)
        .finally(() => setBusy(false));
  }

  return (
    <section className="shift-form__section" aria-label="Roster">
      <h2 className="shift-form__section-title">Workers Assigned To This Shift</h2>

      {shift.assignments.length === 0 ? (
        <p className="shift-form__note">No workers assigned yet.</p>
      ) : (
        <ul className="shift-form__roster">
          {shift.assignments.map((a) => (
            <RosterRow
              key={a.id}
              assignment={a}
              workerLabel={nameById.get(a.workerId) ?? a.workerId}
              busy={busy}
              onSave={handleSave}
              onRemove={handleRemove}
            />
          ))}
        </ul>
      )}

      <AddWorker
        workers={workers}
        assigned={shift.assignments.map((a) => a.workerId)}
        busy={busy}
        onAdd={handleAdd}
      />

      {error && <p className="shift-form__error" role="alert">{error}</p>}
    </section>
  );
}

function RosterRow({
  assignment,
  workerLabel,
  busy,
  onSave,
  onRemove,
}: Readonly<{
  assignment: Assignment;
  workerLabel: string;
  busy: boolean;
  onSave: (assignmentId: string, body: ShiftAssignmentUpdate) => void;
  onRemove: (assignmentId: string) => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [taskName, setTaskName] = useState(assignment.taskName ?? "");
  const [intensity, setIntensity] = useState<Intensity>(assignment.intensity);
  const [acclDay, setAcclDay] = useState(assignment.acclimatisationDay?.toString() ?? "");

  function startEdit() {
    // Re-seed the drafts from the row's current values each time editing opens.
    setTaskName(assignment.taskName ?? "");
    setIntensity(assignment.intensity);
    setAcclDay(assignment.acclimatisationDay?.toString() ?? "");
    setEditing(true);
  }

  function save() {
    onSave(assignment.id, {
      intensity,                                        // required — never omitted
      taskName: taskName.trim() || undefined,           // blank → undefined (clears it deliberately)
      acclimatisationDay: acclDay ? Number(acclDay) : undefined,
    });
    setEditing(false);
  }

  if (!editing) {
    return (
      <li className="shift-form__roster-row">
        <span className="shift-form__roster-name">{workerLabel}</span>
        
        <div className="shift-form__roster-meta">
          {assignment.taskName && (
            <span className="shift-form__meta-item">
              <span className="shift-form__meta-label">Task Assigned:</span> {assignment.taskName}
            </span>
          )}
          <span className="shift-form__meta-item">
            <span className="shift-form__meta-label">Workload Intensity:</span> {assignment.intensity}
          </span>
          {assignment.acclimatisationDay && (
            <span className="shift-form__meta-item">
              <span className="shift-form__meta-label">Acclimatisation Day:</span> {assignment.acclimatisationDay}
            </span>
          )}
        </div>
        <button type="button" disabled={busy} onClick={startEdit}>Edit Worker's Details</button>
        <button type="button" className="shift-form__danger" disabled={busy} onClick={() => onRemove(assignment.id)}>Remove This Worker</button>
      </li>
    );
  }

  // Edit mode mirrors the Create-shift worker row: a labelled `.shift-form__row card`. The worker's
  // name is the legend (not editable — a swap is remove + add), and intensity reuses the same
  // WorkIntensitySegmented control the create form uses.
  return (
    <li>
      <fieldset className="shift-form__row card">
        <legend>{workerLabel}</legend>

        <label htmlFor={`task-${assignment.id}`}>Task (optional)</label>
        <input
          id={`task-${assignment.id}`}
          type="text"
          maxLength={120}
          value={taskName}
          disabled={busy}
          onChange={(e) => setTaskName(e.target.value)}
        />

        <WorkIntensitySegmented
          name={`intensity-${assignment.id}`}
          value={intensity}
          onChange={setIntensity}
        />

        <label htmlFor={`accl-${assignment.id}`}>Acclimatisation Days (if applicable)</label>
        <input
          id={`accl-${assignment.id}`}
          type="number"
          min={1}
          max={7}
          value={acclDay}
          disabled={busy}
          onChange={(e) => setAcclDay(e.target.value)}
        />

        <div className="shift-form__actions">
          <button type="button" disabled={busy} onClick={save}>Save</button>
          <button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </fieldset>
    </li>
  );
}

function AddWorker({
  workers,
  assigned,
  busy,
  onAdd,
}: Readonly<{
  workers: SiteWorker[];
  assigned: string[];
  busy: boolean;
  onAdd: (body: ShiftAssignmentCreate) => void;
}>) {
  const [adding, setAdding] = useState(false);
  const [workerId, setWorkerId] = useState("");
  const [intensity, setIntensity] = useState<Intensity>("MODERATE");
  const [taskName, setTaskName] = useState("");
  const [acclDay, setAcclDay] = useState("");

  // A worker already on the shift shouldn't be able to be added twice.
  const available = workers.filter((w) => !assigned.includes(w.id));

  const reset = () => {
    setWorkerId("");
    setTaskName("");
    setIntensity("MODERATE");
    setAcclDay("");
  };

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workerId) return;
    onAdd({
      workerId,
      intensity,
      taskName: taskName.trim() || undefined,
      acclimatisationDay: acclDay ? Number(acclDay) : undefined,
    });
    reset(); // stays open with cleared fields, ready for the next add
  };

  // Hidden until needed — same pattern as the Create-shift page: reveal the picker only on demand.
  if (!adding) {
    return (
      <button type="button" className="shift-form__add-worker-toggle" disabled={busy} onClick={() => setAdding(true)}>
        Add Worker
      </button>
    );
  }

  // Same labelled card as the Create-shift worker row (and the roster edit mode).
  return (
    <form onSubmit={submit}>
      <fieldset className="shift-form__row card">
        <legend>Add a worker</legend>

        <label htmlFor="add-worker">Worker</label>
        <select
          id="add-worker"
          required
          value={workerId}
          disabled={busy}
          onChange={(e) => setWorkerId(e.target.value)}
        >
          <option value="">Select a worker…</option>
          {available.map((w) => (
            <option key={w.id} value={w.id}>{w.displayName}</option>
          ))}
        </select>

        <WorkIntensitySegmented name="add-intensity" value={intensity} onChange={setIntensity} />

        <label htmlFor="add-task">Task (optional)</label>
        <input
          id="add-task"
          type="text"
          maxLength={120}
          value={taskName}
          disabled={busy}
          onChange={(e) => setTaskName(e.target.value)}
        />

        <label htmlFor="add-accl">Acclimatisation day (optional)</label>
        <input
          id="add-accl"
          type="number"
          min={1}
          max={7}
          value={acclDay}
          disabled={busy}
          onChange={(e) => setAcclDay(e.target.value)}
        />

        <div className="shift-form__actions">
          <button type="submit" disabled={busy || !workerId}>Add</button>
          <button type="button" disabled={busy} onClick={() => { reset(); setAdding(false); }}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
