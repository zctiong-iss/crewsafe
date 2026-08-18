/** @author Tang Chee Seng (with assistance from Claude) */
import { apiFetch, apiDownload } from "./client";

/** One assembled timeline row — every field already inspector-readable (server-resolved). */
export interface AuditEntry {
  occurredAt: string; // ISO
  actorName: string; // resolved; "system / unauthenticated" when the source actorId is null
  eventLabel: string; // human label for eventType (e.g. "Shift created")
  eventType: string; // raw constant, kept for filtering / exact reference
  targetType: string;
  targetId: string;
  correlationId: string; // the trace id an inspector follows across rows
  detail: string | null;
}

/** A page of the timeline. Cursor-free offset paging keeps the first cut simple. */
export interface AuditPage {
  siteId: string;
  from: string;
  to: string;
  page: number; // 0-based
  pageSize: number;
  totalEntries: number;
  entries: AuditEntry[];
}

export function fetchAuditPage(
  siteId: string,
  from: string,
  to: string,
  page: number,
  pageSize = 50,
): Promise<AuditPage> {
  const query = new URLSearchParams({
    from,
    to,
    page: String(page),
    pageSize: String(pageSize),
  }).toString();
  return apiFetch<AuditPage>(`/api/v1/sites/${siteId}/audit?${query}`);
}

/** The whole slice as a downloadable CSV (not paginated — the export is complete by definition). */
export function downloadAuditCsv(siteId: string, from: string, to: string) {
  const query = new URLSearchParams({ from, to }).toString();
  return apiDownload(`/api/v1/sites/${siteId}/audit/export.csv?${query}`);
}
