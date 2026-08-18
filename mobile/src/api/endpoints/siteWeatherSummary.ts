/**
 * One WBGT reading per site, across everything the caller oversees.
 *
 * REAL — `SiteWeatherSummaryController` implements this. Only `mock` auth mode diverges.
 *
 *   GET /api/v1/weather/site-summary   WORKER / SUPERVISOR / SAFETY_MANAGER / ADMIN
 *
 * ── WHY THIS IS NOT SITE-SCOPED ─────────────────────────────────────────────────────────
 * `…/sites/{siteId}/weather/latest` answers "how is this site?". The question behind the site
 * picker is "which of my sites is hottest?", and a safety manager may hold twenty memberships —
 * twenty round trips to answer, on a phone, outdoors. Scope comes from the caller's own
 * memberships server-side, so there is nothing to pass and nothing to widen.
 *
 * @author Justin Chua
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import { mockSiteWeatherSummary } from "../mock/siteWeatherSummary";
import type { WbgtBand, WeatherQualityStatus } from "@/types/domain";

const MOCK_LATENCY_MS = 250;

/** Mirrors `SiteWeatherSummaryController.SiteWeatherSummary`. */
export interface SiteWeatherSummary {
  siteId: string;
  /** Null when the site has no reading. Render as "no reading", never as a cool one. */
  wbgt: number | null;
  /** Server-evaluated (§12.2). Null exactly when `wbgt` is. */
  band: WbgtBand | null;
  observedAt: string | null;
  freshness: WeatherQualityStatus | null;
}

/**
 * Every site the caller belongs to, including ones with no reading (as nulls).
 *
 * The server fills those in rather than omitting them: on a screen for comparing sites, an
 * absent site is indistinguishable from one that dropped off the list, which is worse than one
 * that says plainly it has no data.
 */
export function fetchSiteWeatherSummary(): Promise<SiteWeatherSummary[]> {
  if (isMockApi()) {
    return new Promise((resolve) =>
      setTimeout(() => resolve(mockSiteWeatherSummary()), MOCK_LATENCY_MS),
    );
  }
  return request<SiteWeatherSummary[]>({ url: "/api/v1/weather/site-summary", method: "GET" });
}
