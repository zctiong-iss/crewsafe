/** @author Tang Chee Seng (with assistance from Claude) */
import { apiFetch } from "./client";

/**
 * One bar in the compliance chart: a day (or category) and how its dispatched actions resolved.
 * `actedOn` = a person acknowledged/completed; `lapsed` = the sweep marked it LATE or auto-completed.
 * The two always sum to `dispatched`.
 */
export interface ComplianceBucket {
  label: string; // e.g. "Mon 11", server-formatted in the site's timezone
  dispatched: number;
  actedOn: number;
  lapsed: number;
}

/** One bar in the response-time histogram: a latency band and how many acks fell in it. */
export interface ResponseTimeBucket {
  label: string; // e.g. "0–1m", "1–2m", "5m+"
  count: number;
}

export interface ComplianceReport {
  siteId: string;
  from: string; // ISO date-time, inclusive (echoed back for display)
  to: string; // ISO date-time, exclusive
  dispatched: number; // total dispatched actions in range for this site
  actedOn: number; // acknowledged or completed by a worker
  lapsed: number; // LATE or auto-completed (sweep stepped in)
  complianceRate: number; // actedOn / dispatched, 0..1; server-computed, not derived here
  p50ResponseSeconds: number | null; // null when there were no acknowledged actions
  p95ResponseSeconds: number | null;
  compliance: ComplianceBucket[]; // ordered oldest->newest for the bar chart
  responseTimes: ResponseTimeBucket[];
}

/**
 * Compliance & response-time report for one site over [from, to).
 * `from`/`to` are ISO date-time strings; the server floors/ceils to the site's timezone.
 */
export function fetchComplianceReport(
  siteId: string,
  from: string,
  to: string,
): Promise<ComplianceReport> {
  const query = new URLSearchParams({ from, to }).toString();
  return apiFetch<ComplianceReport>(`/api/v1/sites/${siteId}/insights/compliance?${query}`);
}
