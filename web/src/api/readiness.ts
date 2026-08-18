/** @author Tang Chee Seng (with assistance from Claude) */
import { apiFetch } from "./client";

/** Server-classified. The web renders this; it never derives "stale" itself (freshness is a policy judgement). */
export type ReadinessStatus = "SUBMITTED" | "STALE" | "MISSING";

export interface WorkerReadiness {
  workerId: string;
  displayName: string;
  status: ReadinessStatus;
  fitToWork: boolean | null; // null when MISSING (no submission to read it from)
  submittedAt: string | null; // null when MISSING
  flaggedSymptom: boolean; // true if the latest submission carried any non-NONE symptom
}

export interface ShiftReadiness {
  shiftId: string;
  startsAt: string;
  endsAt: string;
  status: string; // PLANNED | ACTIVE
  submitted: number;
  stale: number;
  missing: number;
  workers: WorkerReadiness[];
}

export interface SiteReadinessSummary {
  siteId: string;
  shifts: ShiftReadiness[]; // upcoming (PLANNED/ACTIVE), soonest first
}

/** Every upcoming shift's roster readiness for a site — supervisor-scoped. */
export function fetchReadinessSummary(siteId: string): Promise<SiteReadinessSummary> {
  return apiFetch<SiteReadinessSummary>(`/api/v1/sites/${siteId}/readiness-summary`);
}
