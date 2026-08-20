/** @author Tang Chee Seng (with assistance from Claude) */
import { apiFetch, apiDownload } from "./client";
import type { WbgtBand } from "./conditionsStream";

/**
 * The SCRUM-139 (US-44) shift close-out summary. Every countable field is server-derived from the
 * shift's own audit rows, so a total here is a {@code COUNT(*)} of the audit trail — the web view
 * only paints it. Nullable fields are omitted by the backend (Jackson NON_NULL), hence the
 * optionals: an unclosed shift ships no {@code closed*}, a shift with no reading no {@code peak*}.
 */
export interface ShiftCloseSummary {
  shiftId: string;
  siteId: string;
  siteName: string;
  startsAt: string;
  endsAt: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED" | "CANCELLED";
  localRange: string;
  workerCount: number;
  closedAt?: string;
  closedByName?: string;
  conditions: {
    readinessSubmissions: number;
    peakWbgt?: number;
    peakBand?: WbgtBand;
  };
  actions: {
    issued: number;
    acknowledged: number;
    completed: number;
    exceptions: number;
  };
  totalAuditEvents: number;
  eventCountsByType: Record<string, number>;
}

export function fetchShiftSummary(siteId: string, shiftId: string): Promise<ShiftCloseSummary> {
  return apiFetch<ShiftCloseSummary>(`/api/v1/sites/${siteId}/shifts/${shiftId}/summary`);
}

/** The shift's close-out record as a downloadable, checksum-verifiable CSV. */
export function downloadShiftSummaryCsv(siteId: string, shiftId: string) {
  return apiDownload(`/api/v1/sites/${siteId}/shifts/${shiftId}/summary/export.csv`);
}
