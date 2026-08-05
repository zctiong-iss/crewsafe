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

export interface Shift {
    id: string;
    siteId: string;
    startsAt: string;
    endsAt: string;
    status: "PLANNED" | "ACTIVE" | "CLOSED"
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