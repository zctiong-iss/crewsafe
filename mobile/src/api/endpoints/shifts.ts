/**
 * The supervisor shift surface (SCRUM-161), against `docs/api/shift.yaml`.
 *
 * All of this is REAL — `ShiftController` implements every operation here, field for field
 * with the contract. Only `mock` auth mode diverges, and only for want of a backend.
 *
 * Two authorization shapes worth keeping straight, because they are not the same:
 *
 *   GET  /sites/{id}/shifts           `@siteAccess.canAccess` only — any member may read,
 *                                     including a WORKER.
 *   GET  /sites/{id}/workers          additionally role-gated to SUPERVISOR / SAFETY_MANAGER
 *   POST, PATCH, DELETE               / ADMIN. A worker may read their site's shifts but not
 *                                     plan them, and may not enumerate the crew.
 *
 * Every one of them answers 403 — never 404 — for a site the caller does not belong to.
 * Distinguishing "does not exist" from "not yours" would leak which sites exist.
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import {
  mockCreateShift,
  mockDeleteShift,
  mockGetShift,
  mockListShifts,
  mockListSiteWorkers,
} from "../mock/shifts";
import type { Intensity, Shift, SiteWorker } from "@/types/domain";

const MOCK_LATENCY_MS = 350;

function delay<T>(produce: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(produce());
      } catch (error) {
        reject(error);
      }
    }, MOCK_LATENCY_MS),
  );
}

/** `GET /api/v1/sites/{siteId}/shifts` — most recently created first. */
export function fetchShifts(siteId: string): Promise<Shift[]> {
  if (isMockApi()) return delay(() => mockListShifts(siteId));
  return request<Shift[]>({ url: `/api/v1/sites/${siteId}/shifts`, method: "GET" });
}

/** `GET /api/v1/sites/{siteId}/shifts/{shiftId}` — includes every assignment. */
export function fetchShift(siteId: string, shiftId: string): Promise<Shift> {
  if (isMockApi()) return delay(() => mockGetShift(siteId, shiftId));
  return request<Shift>({ url: `/api/v1/sites/${siteId}/shifts/${shiftId}`, method: "GET" });
}

/**
 * `GET /api/v1/sites/{siteId}/workers` — candidates for `assignments[].workerId`.
 *
 * ACTIVE workers only, alphabetical by display name. An offboarded worker cannot be newly
 * assigned, though existing assignments referencing them are untouched — which is why a
 * detail view must be able to render a worker id it cannot find a name for.
 */
export function fetchSiteWorkers(siteId: string): Promise<SiteWorker[]> {
  if (isMockApi()) return delay(() => mockListSiteWorkers(siteId));
  return request<SiteWorker[]>({ url: `/api/v1/sites/${siteId}/workers`, method: "GET" });
}

/** `DELETE /api/v1/sites/{siteId}/shifts/{shiftId}` — removes the shift and its assignments. */
export function deleteShift(siteId: string, shiftId: string): Promise<void> {
  if (isMockApi()) return delay(() => mockDeleteShift(siteId, shiftId));
  return request<void>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}`,
    method: "DELETE",
  });
}

export interface ShiftAssignmentInput {
  workerId: string;
  taskName?: string;
  intensity: Intensity;
  acclimatisationDay?: number;
}

/**
 * `POST /api/v1/sites/{siteId}/shifts` — used by step 7's create form.
 *
 * `status` is deliberately absent from the request: it is server-controlled and every shift
 * is created PLANNED. Sending one would be rejected, and a client that could set it could
 * declare its own shift already closed.
 */
export function createShift(
  siteId: string,
  startsAt: string,
  endsAt: string,
  assignments: ShiftAssignmentInput[],
): Promise<Shift> {
  if (isMockApi()) {
    return delay(() =>
      mockCreateShift(
        siteId,
        startsAt,
        endsAt,
        assignments.map((a) => ({
          workerId: a.workerId,
          taskName: a.taskName ?? null,
          intensity: a.intensity,
          acclimatisationDay: a.acclimatisationDay ?? null,
        })),
      ),
    );
  }

  return request<Shift>({
    url: `/api/v1/sites/${siteId}/shifts`,
    method: "POST",
    data: { startsAt, endsAt, assignments },
  });
}
