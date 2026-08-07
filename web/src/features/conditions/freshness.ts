/** @author Tang Chee Seng (with assistance from Claude) */
import type { LatestWeather } from "@/api/weather";

export type FreshnessLevel = "fresh" | "delayed" | "stale";
export interface Freshness { level: FreshnessLevel; ageSeconds: number; label: string; }

const DELAYED_AFTER_S = 20 * 60;
const STALE_AFTER_S = 45 * 60;

export function assessFreshness(reading: LatestWeather, now: Date = new Date()): Freshness {
  const ageSeconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(reading.observedAt).getTime()) / 1000),
  );
  const label = ageSeconds < 60 ? "just now" : `${Math.floor(ageSeconds / 60)} min ago`;

  if (reading.qualityStatus === "STALE" || reading.qualityStatus === "SIMULATED")
    return { level: "stale", ageSeconds, label };

  const level: FreshnessLevel =
    ageSeconds >= STALE_AFTER_S ? "stale" : ageSeconds >= DELAYED_AFTER_S ? "delayed" : "fresh";
  return { level, ageSeconds, label };
}