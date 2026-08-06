/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { fetchSiteShifts, type Shift } from "@/api/shifts";
import { fetchSiteWorkers } from "@/api/workers";
import { fetchAccessibleSites } from "@/api/identity";
import { ShiftCard } from "./ShiftCard";
import "./ShiftList.css";

  type Load =
  | { status: "loading" }
  | { status: "loaded"; shifts: Shift[]; workerNames: Map<string, string>; siteNames: Map<string, string> }
  | { status: "error"; message: string; requestId: string | null };

// ShiftList.tsx — signature + effect (render body unchanged)
export function ShiftList({ siteIds }: { siteIds: string[] }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let active = true;
    Promise.all([
      Promise.all(siteIds.map((id) => fetchSiteShifts(id))),
      Promise.all(siteIds.map((id) => fetchSiteWorkers(id))),
      fetchAccessibleSites(),
    ])
      .then(([shiftsBySite, workersBySite, sites]) => {
        if (!active) return;
        const shifts = shiftsBySite.flat().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        const workerNames = new Map(workersBySite.flat().map((w) => [w.id, w.displayName]));
        const siteNames = new Map(sites.map((s) => [s.id, s.name]));
        setLoad({ status: "loaded", shifts, workerNames, siteNames });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => { active = false; };
  }, [siteIds]);

  const createButton = <Link className="shift-list__create" to="/shifts/new">Create New Shift</Link>;

  return (
    <AppShell title="Shifts & Tasks" actions={createButton}>
      {load.status === "loading" && <p role="status">Loading shifts…</p>}

      {load.status === "error" && (
        <EmptyState headline="Could not load shifts" body={load.message} />
      )}

      {load.status === "loaded" && load.shifts.length === 0 && (
        <EmptyState
          headline="No shifts yet"
          body="Nothing is scheduled for this site. Create the first shift to get started."
          action={createButton}
        />
      )}

      {load.status === "loaded" && load.shifts.length > 0 && (
        <section className="shift-list" aria-label="Shifts">
          {load.shifts.map((shift) => (
            <ShiftCard key={shift.id} shift={shift} workerNames={load.workerNames} siteNames={load.siteNames} />  // + siteNames
          ))}
        </section>
      )}
    </AppShell>
  );
}