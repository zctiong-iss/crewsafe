/**
 * @author Jemilin Beulah
 */
import { apiFetch } from "./client";
import { ApiError } from "./errors";
import type { LightningRiskState, WeatherFreshness, WeatherSource } from "./conditionsStream";

/** Mirrors LightningController.LightningRiskResponse field for field. */
export interface LightningRisk {
  siteId: string;
  state: LightningRiskState;
  nearestStrikeKm: number | null;
  observedAt: string;
  validUntil: string;
  freshness: WeatherFreshness;
}

/** Mirrors LightningController.LightningObservationResponse field for field. */
export interface LightningObservation {
  id: string;
  siteId: string;
  /** Null when NEA reported no strikes that tick — a valid outcome, not a missing value. */
  nearestStrikeKm: number | null;
  nearestStrikeAt: string | null;
  observedAt: string;
  ingestedAt: string;
  source: WeatherSource;
  qualityStatus: WeatherFreshness;
}

/**
 * The site's current derived hazard state, or null when lightning has never been ingested
 * for it — the server 404s for that case rather than defaulting to CLEAR (see
 * LightningController.getLightningRisk).
 */
export function fetchLightningRisk(siteId: string): Promise<LightningRisk | null> {
  return apiFetch<LightningRisk>(`/api/v1/sites/${siteId}/lightning`).catch((error: unknown) => {
    if (error instanceof ApiError && error.kind === "not-found") return null;
    throw error;
  });
}

/** Recent ingestion ticks for the site, newest first. Empty, not 404, when none exist. */
export function fetchLightningObservations(siteId: string): Promise<LightningObservation[]> {
  return apiFetch<LightningObservation[]>(`/api/v1/sites/${siteId}/lightning/observations`);
}
