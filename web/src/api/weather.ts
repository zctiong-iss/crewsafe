/** @author Tang Chee Seng (with assistance from Claude) */
import { apiFetch } from "./client";

export interface LatestWeather {
  id: string;
  siteId: string;
  wbgt: number | null;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  rainfall: number | null;
  observedAt: string;
  ingestedAt: string;
  source: "NEA" | "MANUAL" | "CACHED";
  qualityStatus: "LIVE" | "DELAYED" | "STALE" | "SIMULATED";
  stationId?: string | null;
}

export function fetchLatestWeather(siteId: string): Promise<LatestWeather> {
  return apiFetch<LatestWeather>(`/api/v1/sites/${siteId}/weather/latest`);
}