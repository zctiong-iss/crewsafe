/** @author Tang Chee Seng (with assistance from Claude) */
import { useState, type SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { updateShift, cancelShift, type Shift } from "@/api/shifts";
import { validateShift, type FieldErrors } from "./validateShift";
import { ShiftTimeFields } from "./ShiftTimeFields";
import { ShiftRoster } from "./ShiftRoster";
import "./CreateShiftForm.css";

type Action =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; shift: Shift }
  | { status: "cancelling" }
  | { status: "cancelled"; shift: Shift }
  | { status: "error"; message: string; requestId: string | null };

export function EditShiftForm({ shift: initial }: { shift: Shift }) {
  // The shift is stateful: roster edits (add/update/remove) replace it via setShift. The time
  // pickers keep their OWN state, seeded once from `initial`, so a roster change never resets an
  // unsaved time edit — and a time edit never touches the roster.
  const [shift, setShift] = useState<Shift>(initial);
  const [startsAt, setStartsAt] = useState<Date | null>(new Date(initial.startsAt));
  const [endsAt, setEndsAt] = useState<Date | null>(new Date(initial.endsAt));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<Action>({ status: "idle" });

  // Contract-known rule (not related to SCRUM-256 - involving a specific time cut-off): only these two are cancellable.
  const cancellable = shift.status === "PLANNED" || shift.status === "ACTIVE";

  const handleSave = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = { startsAt: startsAt?.toISOString() ?? "", endsAt: endsAt?.toISOString() ?? "" };
    const found = validateShift(body);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setAction({ status: "saving" });
    updateShift(shift.siteId, shift.id, body)
      .then((updated) => setAction({ status: "saved", shift: updated }))
      .catch((error: unknown) => {
        const err = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setAction({ status: "error", message: messageFor(err), requestId: err.requestId });
      });
  };

    function confirmCancel() {
    setAction({ status: "cancelling" });
    cancelShift(shift.siteId, shift.id, reason.trim())
      .then((cancelled) => setAction({ status: "cancelled", shift: cancelled }))
      .catch((error: unknown) => {
        const err = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        // 400 = server refused (already CLOSED/CANCELLED, a future feature related to SCRUM-256 cut-off, or a rejected
        // reason). 403 = not permitted — messageFor keeps them signed in.
        setAction({ status: "error", message: messageFor(err), requestId: err.requestId });
        setConfirming(false);
      });
  }

  if (action.status === "saved") {
    return (
      <AppShell title="Edit Shift">
        <EmptyState headline="Shift updated" body={`Shift ${action.shift.id} now runs the corrected times.`}
          action={<Link to="/shifts">Back to Shifts</Link>} />
      </AppShell>
    );
  }
  if (action.status === "cancelled") {
    return (
      <AppShell title="Edit Shift">
        <EmptyState headline="Shift cancelled" body={`Shift ${action.shift.id} is ${action.shift.status}. This cannot be undone.`}
          action={<Link to="/shifts">Back to Shifts</Link>} />
      </AppShell>
    );
  }

  return (
    <AppShell title="Edit Shift">
      <div className="shift-form">
      <form className="shift-form" onSubmit={handleSave}>
        <section className="shift-form__section">
          <h2 className="shift-form__section-title">Edit Shift Schedule Details</h2>
          <p className="shift-form__note">Current status: {shift.status}</p>
          <ShiftTimeFields
            startsAt={startsAt}
            endsAt={endsAt}
            onStartChange={setStartsAt}
            onEndChange={setEndsAt}
            endError={errors.endsAt}
          />
        </section>

        {action.status === "error" && (
          <p className="shift-form__error" role="alert">
            {action.message}
            {action.requestId && <> Reference <span className="code">{action.requestId}</span>.</>}
          </p>
        )}

        <div className="shift-form__actions">
          <Link className="shift-form__back" to="/shifts">Back</Link>
          <button type="submit" disabled={action.status === "saving"}>
            {action.status === "saving" ? "Saving…" : "Update Shift Schedule"}
          </button>
        </div>
      </form>

      {/* Roster edits persist immediately and each replaces the shift we hold. Rendered outside the
        times <form> so an assignment change never triggers the times submit. */}
      <ShiftRoster shift={shift} onShiftChange={setShift} />

      <section className="shift-form__section" aria-label="Cancel shift">
        <h2 className="shift-form__section-title">Cancel This Shift</h2>
        {!cancellable ? (
          <p className="shift-form__note" role="status">
            A {shift.status} shift can no longer be cancelled.
          </p>
        ) : !confirming ? (
          <button type="button" onClick={() => setConfirming(true)}>Cancel Shift</button>
        ) : (
          <div className="shift-form__cancel-confirm">
            <p className="shift-form__error">A record of this shift will still be kept for audit purposes. </p>
            <label htmlFor="cancel-reason">Reason for Cancelling Shift (for audit purposes)</label>
            <textarea
              id="cancel-reason"
              className="shift-form__reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              required
            />
            <div className="shift-form__actions">
              <button type="button" onClick={() => { setConfirming(false); setReason(""); }}>Keep This Shift</button>
              <button
                type="button"
                className="shift-form__danger"
                disabled={action.status === "cancelling" || reason.trim() === ""}
                onClick={confirmCancel}
              >
                {action.status === "cancelling" ? "Cancelling…" : "Confirm Shift Cancellation"}
              </button>
            </div>
          </div>
        )}
        </section>
      </div>  
    </AppShell>
  );
}