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
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import {
  mockAddAssignment,
  mockRemoveAssignment,
  mockUpdateAssignment,
  mockUpdateShift,
  mockCreateShift,
  mockCancelShift,
  mockCloseShift,
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

/**
 * `POST /api/v1/sites/{siteId}/shifts/{shiftId}/cancel` — the shift was called off (SCRUM-442).
 *
 * PLANNED or ACTIVE only, and terminal: there is no un-cancel. `reason` is required by the
 * server (`@NotBlank`, max 500) and lands in the audit trail, so it is the record of *why* a
 * crew was stood down rather than a formality.
 *
 * Distinct from `deleteShift`, which erases the shift and its assignments outright. A cancelled
 * shift stays visible as "this did not happen"; a deleted one leaves nothing behind.
 */
export function cancelShift(siteId: string, shiftId: string, reason: string): Promise<Shift> {
  if (isMockApi()) return delay(() => mockCancelShift(siteId, shiftId, reason));
  return request<Shift>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/cancel`,
    method: "POST",
    data: { reason },
  });
}

/**
 * `POST /api/v1/sites/{siteId}/shifts/{shiftId}/close` — the shift ran and is finished (SCRUM-442).
 *
 * PLANNED or ACTIVE only, terminal, and — unlike cancel — refused while `endsAt` is still in
 * the future. `ShiftService.closeShift` states the rule plainly: a shift cannot be closed
 * early, and cancel is the tool for calling one off before it ends. No body: closing records
 * that time ran out, which needs no explanation the way calling one off does.
 */
export function closeShift(siteId: string, shiftId: string): Promise<Shift> {
  if (isMockApi()) return delay(() => mockCloseShift(siteId, shiftId));
  return request<Shift>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/close`,
    method: "POST",
  });
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

/**
 * `PATCH /api/v1/sites/{siteId}/shifts/{shiftId}` — corrects the window (SCRUM-266).
 *
 * `status` is absent for the same reason it is absent from create: it is server-controlled, and
 * a client that could set it could declare its own shift already closed — which is precisely
 * the state the server now refuses to edit.
 *
 * The server rejects an edit to a shift that has ended, with a 400 the caller surfaces rather
 * than swallows. That rule is enforced there, not here, so no other client can skip it.
 */
export function updateShift(
  siteId: string,
  shiftId: string,
  startsAt: string,
  endsAt: string,
): Promise<Shift> {
  if (isMockApi()) return delay(() => mockUpdateShift(siteId, shiftId, startsAt, endsAt));
  return request<Shift>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}`,
    method: "PATCH",
    data: { startsAt, endsAt },
  });
}

/**
 * `PATCH …/shifts/{shiftId}/assignments/{assignmentId}` — the correction this ticket exists for.
 *
 * Task, intensity and acclimatisation day. **Not `workerId`**: moving an assignment to a
 * different person is a remove and an add, not a correction, and the audit trail should say so.
 * The server agrees — `ShiftAssignment.correct` does not accept one.
 *
 * Returns the whole updated shift, so a caller can replace what it holds rather than patching
 * its own copy and hoping the two agree.
 */
export function updateAssignment(
  siteId: string,
  shiftId: string,
  assignmentId: string,
  input: Omit<ShiftAssignmentInput, "workerId">,
): Promise<Shift> {
  if (isMockApi()) {
    return delay(() =>
      mockUpdateAssignment(
        siteId,
        shiftId,
        assignmentId,
        input.taskName,
        input.intensity,
        input.acclimatisationDay,
      ),
    );
  }
  return request<Shift>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/assignments/${assignmentId}`,
    method: "PATCH",
    data: input,
  });
}

/** `POST …/shifts/{shiftId}/assignments` — staffs an existing shift. Returns the updated shift. */
export function addAssignment(
  siteId: string,
  shiftId: string,
  input: ShiftAssignmentInput,
): Promise<Shift> {
  if (isMockApi()) {
    return delay(() =>
      mockAddAssignment(siteId, shiftId, {
        workerId: input.workerId,
        taskName: input.taskName ?? null,
        intensity: input.intensity,
        acclimatisationDay: input.acclimatisationDay ?? null,
      }),
    );
  }
  return request<Shift>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/assignments`,
    method: "POST",
    data: input,
  });
}

/** `DELETE …/shifts/{shiftId}/assignments/{assignmentId}` — takes one worker off, not the shift. */
export function removeAssignment(
  siteId: string,
  shiftId: string,
  assignmentId: string,
): Promise<void> {
  if (isMockApi()) return delay(() => mockRemoveAssignment(siteId, shiftId, assignmentId));
  return request<void>({
    url: `/api/v1/sites/${siteId}/shifts/${shiftId}/assignments/${assignmentId}`,
    method: "DELETE",
  });
}
