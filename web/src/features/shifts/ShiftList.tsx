/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { fetchSiteShifts, type Shift } from "@/api/shifts";
import { fetchSiteWorkers, type SiteWorker } from "@/api/workers";
import { fetchAccessibleSites } from "@/api/identity";
import { useCurrentUser } from "@/auth/useAuth";
import { ShiftCard } from "./ShiftCard";
import "./ShiftList.css";

  type Load =
  | { status: "loading" }
  | { status: "loaded"; shifts: Shift[]; workerNames: Map<string, string>; siteNames: Map<string, string> }
  | { status: "error"; message: string; requestId: string | null };

// ShiftList.tsx — signature + effect (render body unchanged)
export function ShiftList({ siteIds }: Readonly<{ siteIds: string[] }>) {
  const user = useCurrentUser();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const isWorker = user.role === "WORKER";

  useEffect(() => {
    let active = true;
    Promise.all([
      Promise.all(siteIds.map((id) => fetchSiteShifts(id))),
      // The roster is a supervisor tool — SiteController refuses it to workers. Asking anyway
      // would reject this whole Promise.all and blank a page whose shifts had loaded fine.
      isWorker
        ? Promise.resolve<SiteWorker[][]>([])
        : Promise.all(siteIds.map((id) => fetchSiteWorkers(id))),
      fetchAccessibleSites(),
    ])
      .then(([shiftsBySite, workersBySite, sites]) => {
        if (!active) return;
        const all = shiftsBySite.flat().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        // A worker's board answers "where am I meant to be", not "who is on site today".
        const shifts = isWorker
          ? all.filter((s) => s.assignments.some((a) => a.workerId === user.id))
          : all;
        // With the roster closed, the only name a worker can be shown is their own.
        const workerNames = isWorker
          ? new Map([[user.id, user.displayName]])
          : new Map(workersBySite.flat().map((w) => [w.id, w.displayName]));
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
  }, [siteIds, isWorker, user.id, user.displayName]);

  const createButton = !isWorker ? (
    <Link className="shift-list__create" to="/shifts/new">Create New Shift</Link>
  ) : null;

  return (
    <AppShell title={isWorker ? "My Shifts & Tasks" : "Shifts & Tasks"} actions={createButton}>
      {load.status === "loading" && (
        <output style={{ display: "block" }}>Loading shifts…</output>
      )}

      {load.status === "error" && (
        <EmptyState headline="Could not load shifts" body={load.message} />
      )}

      {load.status === "loaded" && load.shifts.length === 0 && (
        <EmptyState
          headline={isWorker ? "No shifts assigned" : "No shifts yet"}
          body={isWorker ? "You are not assigned to any upcoming shifts." : "Nothing is scheduled for this worksite. Create the first shift to get started."}
          action={createButton}
        />
      )}

      {load.status === "loaded" && load.shifts.length > 0 && (
        <section className="shift-list" aria-label="Shifts">
          {load.shifts.map((shift) => (
             <ShiftCard
                key={shift.id}
                shift={shift}
                workerNames={load.workerNames}
                siteNames={load.siteNames}
                currentUserId={user.id}
                crewScope={isWorker ? "self" : "all"}
                canManage={!isWorker}
              />
          ))}
        </section>
      )}
    </AppShell>
  );
}
