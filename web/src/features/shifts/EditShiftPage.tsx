/** @author Tang Chee Seng (with assistance from Claude) */
import { Link, useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import type { Shift } from "@/api/shifts";
import { EditShiftForm } from "./EditShiftForm";

function hasShift(state: unknown): state is { shift: Shift } {
  return typeof state === "object" && state !== null && "shift" in state;
}

export function EditShiftPage() {
  const { state } = useLocation();
  if (!hasShift(state)) {
    return (
      <AppShell title="Edit Shift">
        <EmptyState
          headline="Select a shift from the list to edit."
          body="You are only allowed to edit a planned shift. You cannot edit a cancelled or completed one."
          action={<Link to="/shifts">Back to Shifts</Link>}
        />
      </AppShell>
    );
  }
  return <EditShiftForm shift={state.shift} />;
}