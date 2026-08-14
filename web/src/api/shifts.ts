/** @author Tang Chee Seng (with assistance from Claude) */

import { apiFetch } from "./client";

export type Intensity = "LIGHT" | "MODERATE" | "HEAVY"

export interface ShiftAssignmentCreate {
    workerId: string;
    intensity: Intensity;
    taskName?: string;
    acclimatisationDay?: number;
}

export interface ShiftCreateRequest {
    startsAt: string;
    endsAt: string;
    assignments: ShiftAssignmentCreate[];
}

/** To correct time fields in the shifts */
export interface ShiftUpdateRequest {
    startsAt: string;
    endsAt: string;
}

/** To correct a work assignment detail without deleting entire entry.
    If a supervisor adds a wrong worker by mistake, then the process is to 
    remove, then add the worker to the assignment. */
export interface ShiftAssignmentUpdate {
    intensity: Intensity;
    taskName?: string;
    acclimatisationDay?: number;
}

export interface Shift {
    id: string;
    siteId: string;
    startsAt: string;
    endsAt: string;
    status: "PLANNED" | "ACTIVE" | "CLOSED" | "CANCELLED"
    assignments: (ShiftAssignmentCreate & { id: string }) [];
}

export function createShift(siteId: string, body: ShiftCreateRequest): Promise<Shift> {
    return apiFetch<Shift>(`/api/v1/sites/${siteId}/shifts`,{ 
        method: "POST",
        body: JSON.stringify(body)
        });
    }

export function fetchSiteShifts(siteId: string): Promise<Shift[]> {
    return apiFetch<Shift[]>(`/api/v1/sites/${siteId}/shifts`);
    }

/** Update the start/end time for a shift. Both fields are required; status is not settable here. */
export function updateShift(siteId: string, shiftId: string, body: ShiftUpdateRequest): Promise<Shift> {
    return apiFetch<Shift>(`/api/v1/sites/${siteId}/shifts/${shiftId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        });
    }

/** Cancel a PLANNED/ACTIVE shift. The cancellation reason is required and recorded to the audit
    trail only — it is never stored on the shift card details or returned in any payload. 
    Attempting to cancel a CLOSED/CANCELLED shift will return a 400. */
export function cancelShift(siteId: string, shiftId: string, reason: string): Promise<Shift> {
    return apiFetch<Shift>(`/api/v1/sites/${siteId}/shifts/${shiftId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
        });
    }

/** Add one worker to the shift. Returns the full, authoritative shift with the new row. */
export function addShiftAssignment(siteId: string, shiftId: string, body: ShiftAssignmentCreate): Promise<Shift> {
    return apiFetch<Shift>(`/api/v1/sites/${siteId}/shifts/${shiftId}/assignments`, {
        method: "POST",
        body: JSON.stringify(body),
        });
    }

/** Correct one worker's task / intensity / acclimatisation day. Returns the full shift.
    workerId is not included as part of the body — To swap a worker means it is a full remove + add step. */
export function updateShiftAssignment(
    siteId: string, shiftId: string, assignmentId: string, body: ShiftAssignmentUpdate,
): Promise<Shift> {
    return apiFetch<Shift>(`/api/v1/sites/${siteId}/shifts/${shiftId}/assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        });
    }

/** Take a worker off the shift. The server replies 204 (no body), then resolves to void;
    the caller then drops the row from its own copy of the shift and rebuilds the roster without the removed worker. */
export function removeShiftAssignment(
    siteId: string, shiftId: string, assignmentId: string,
): Promise<void> {
    return apiFetch<void>(`/api/v1/sites/${siteId}/shifts/${shiftId}/assignments/${assignmentId}`, {
        method: "DELETE",
        });
    }