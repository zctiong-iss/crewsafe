/** @author Tang Chee Seng (with assistance from Claude) */
import { apiFetch } from "./client";

/** Mirrors ForecastBasis on the backend — the rung of the ladder that produced this value. */
export type ForecastBasis = "MODEL" | "MODEL_IMPUTED" | "TREND" | "PERSISTENCE";

/**
 * Mirrors SiteForecastService.SiteForecast. The additive basis/degraded/inputAgeMinutes fields
 * are what make the fallback panel possible without any new endpoint.
 */
export interface SiteForecast {
  predictedValue: number;
  horizonMinutes: number; // 30 or 60
  modelVersion: string;
  confidenceIntervalLower: number;
  confidenceIntervalUpper: number;
  generatedAt: string; // ISO
  basis: ForecastBasis;
  inputAgeMinutes: number;
  degraded: boolean; // server-computed = basis != MODEL; do NOT re-derive
}

/**
 * Mirrors ModelStatusService.HorizonAccuracy (camelCase off the wire — the outgoing record has no
 * snake-case JsonNaming, unlike the ML client's read record).
 */
export interface HorizonAccuracy {
  mae: number;
  rmse: number;
  meanBias: number;
  macroF1: number;
  recallAtLeast32: number; // 0..1 — high-risk recall; the safety-critical number
  recallAtLeast33: number;
  maeByActualBand: Record<string, number>; // {band: mae}; flattened for charting in the panel
  confusionMatrix: number[][];
  sampleCount: number;
}

/** Mirrors ModelStatusService.ModelStatus — the deployed model, global (not per-site). */
export interface ModelStatus {
  modelVersion: string;
  approvedForInference: boolean; // false => surface the approvalBlocker as "don't fully trust"
  approvalBlocker: string | null;
  horizons: Record<string, HorizonAccuracy>; // keyed by horizon (e.g. "30"/"60")
}

export function fetchForecast(siteId: string, horizonMinutes: 30 | 60 = 30): Promise<SiteForecast> {
  return apiFetch<SiteForecast>(
    `/api/v1/sites/${siteId}/weather/forecast?horizonMinutes=${horizonMinutes}`,
  );
}

/**
 * Global — the deployed model's validation performance, not a single site's. No siteId.
 * Consumes the endpoint that ALREADY ships (`/api/v1/ml/model-status`), not a new one.
 */
export function fetchModelStatus(): Promise<ModelStatus> {
  return apiFetch<ModelStatus>(`/api/v1/ml/model-status`);
}

/**
 * Pick the horizon to headline. Prefer the 30-minute horizon (matching the fallback panel's
 * default); fall back to whichever key the model actually emitted so the panel never blanks just
 * because the key format differs. Returns null when the model reports no horizons at all.
 */
export function selectHorizon(
  status: ModelStatus,
): { key: string; metrics: HorizonAccuracy } | null {
  const entries = Object.entries(status.horizons);
  const preferred = entries.find(([key]) => key === "30");
  const chosen = preferred ?? entries[0];
  if (chosen === undefined) return null; // model reported no horizons at all
  const [key, metrics] = chosen;
  return { key, metrics };
}

/** Flatten {band: mae} to the array-of-rows Recharts wants, dropping never-tested bands. */
export function bandRows(metrics: HorizonAccuracy): { band: string; mae: number }[] {
  return Object.entries(metrics.maeByActualBand).map(([band, mae]) => ({ band, mae }));
}
