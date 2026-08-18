/** @author Tang Chee Seng, Jemilin Beulah (with assistance from Claude and ChatGPT) */
// Key Purpose: To act as a runtime validation boundary for weather conditions data received from the API.

import type {
  ActiveShiftPayload, ConditionsPayload, ConditionsSnapshot,
  LightningRiskPayload, LightningRiskState, WbgtBand, WeatherFreshness, WeatherSource,  // ← add WbgtBand
} from "./conditionsStream";

export class InvalidConditionsPayloadError extends Error {
  constructor(path: string, expected: string) {
    super(`Invalid conditions payload at ${path}: expected ${expected}`);
    this.name = "InvalidConditionsPayloadError";
  }
}

// UUID: xxxxxxxx-xxxx-Vxxx-Wxxx-xxxxxxxxxxxx
// V = version 1–8; W = RFC variant 8, 9, a, or b
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEATHER_SOURCES: readonly WeatherSource[] = ["NEA", "MANUAL", "CACHED"];
const FRESHNESS_VALUES: readonly WeatherFreshness[] = ["LIVE", "DELAYED", "STALE", "SIMULATED"];
const LIGHTNING_STATES: readonly LightningRiskState[] = ["CLEAR", "ADVISORY", "STOP_WORK"];
const WBGT_BANDS: readonly WbgtBand[] = ["BELOW_31", "31_TO_BELOW_32", "32_TO_BELOW_33", "33_AND_ABOVE"];

// Highest recorded WBGT in Singapore is 35.0°C on 23 Mar 2026, so 36.0°C is a reasonable upper bound at this time.
const WBGT_SANITY_RANGE = {
  minimum: 20,
  maximum: 36,
} as const;

// Note: The range for humidity is set between 30 and 100 as it is closer in alignment to historical humidity metrics, and to flag the risk of inaccurate readings.
const HUMIDITY_SANITY_RANGE = {
  minimum: 30,
  maximum: 100,
} as const;

export type ConditionsRangeMetric = "wbgt" | "humidity";

export interface ConditionsRangeWarning {
  metric: ConditionsRangeMetric;
  value: number;
  minimum: number;
  maximum: number;
}

export interface ConditionsDecodeResult {
  snapshot: ConditionsSnapshot;
  warnings: ConditionsRangeWarning[];
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidConditionsPayloadError(path, "object");
  }
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new InvalidConditionsPayloadError(path, "non-empty string");
  return value;
}
function uuid(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!UUID_PATTERN.test(parsed)) {
    throw new InvalidConditionsPayloadError(path, "UUID");
  }
  return parsed;
}

function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!Number.isFinite(Date.parse(parsed))) throw new InvalidConditionsPayloadError(path, "ISO-8601 timestamp");
  return parsed;
}
function finiteNumber(value: unknown, path: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidConditionsPayloadError(path, "finite number");
  if (minimum !== undefined && value < minimum) throw new InvalidConditionsPayloadError(path, `number >= ${minimum}`);
  if (maximum !== undefined && value > maximum) throw new InvalidConditionsPayloadError(path, `number <= ${maximum}`);
  return value;
}
function member<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new InvalidConditionsPayloadError(path, values.join(" | "));
  return value as T;
}

// Check data within sanity bounds - and only returns warnings
export function findConditionsRangeWarnings(
  value: Pick<ConditionsPayload, "wbgt" | "humidity">,
): ConditionsRangeWarning[] {
  const warnings: ConditionsRangeWarning[] = [];

  if (value.wbgt < WBGT_SANITY_RANGE.minimum || value.wbgt > WBGT_SANITY_RANGE.maximum) {
    warnings.push({ metric: "wbgt", value: value.wbgt, ...WBGT_SANITY_RANGE });
  }
  if (value.humidity < HUMIDITY_SANITY_RANGE.minimum || value.humidity > HUMIDITY_SANITY_RANGE.maximum) {
    warnings.push({ metric: "humidity", value: value.humidity, ...HUMIDITY_SANITY_RANGE });
  }

  return warnings;
}

interface DecodedConditions {
  payload: ConditionsPayload | null;
  warnings: ConditionsRangeWarning[];
}

function conditions(value: unknown): DecodedConditions {
  if (value === null) return { payload: null, warnings: [] };
  const item = record(value, "conditions");

  // Validates data types, but does not reject finite values outside sanity bounds. Only returns warnings.
  const payload: ConditionsPayload = {
    wbgt: finiteNumber(item.wbgt, "conditions.wbgt"),
    currentBand: item.currentBand == null ? null : member(item.currentBand, WBGT_BANDS, "conditions.currentBand"),
    forecastBand: item.forecastBand == null ? null : member(item.forecastBand, WBGT_BANDS, "conditions.forecastBand"),
    forecastWbgt30m: item.forecastWbgt30m == null ? null : finiteNumber(item.forecastWbgt30m, "conditions.forecastWbgt30m"),
    temperature: finiteNumber(item.temperature, "conditions.temperature"),
    humidity: finiteNumber(item.humidity, "conditions.humidity"),
    windSpeed: finiteNumber(item.windSpeed, "conditions.windSpeed", 0),
    rainfall: finiteNumber(item.rainfall, "conditions.rainfall", 0),
    observedAt: timestamp(item.observedAt, "conditions.observedAt"),
    source: member(item.source, WEATHER_SOURCES, "conditions.source"),
    freshness: member(item.freshness, FRESHNESS_VALUES, "conditions.freshness"),
  };

  return { payload, warnings: findConditionsRangeWarnings(payload) };
}

function lightning(value: unknown): LightningRiskPayload | null {
  if (value === null) return null;
  const item = record(value, "lightning");
  return {
    state: member(item.state, LIGHTNING_STATES, "lightning.state"),
    nearestStrikeKm: item.nearestStrikeKm === null
      ? null
      : finiteNumber(item.nearestStrikeKm, "lightning.nearestStrikeKm", 0),
    observedAt: timestamp(item.observedAt, "lightning.observedAt"),
    validUntil: timestamp(item.validUntil, "lightning.validUntil"),
    freshness: member(item.freshness, FRESHNESS_VALUES, "lightning.freshness"),
  };
}
function activeShift(value: unknown): ActiveShiftPayload | null {
  if (value === null) return null;
  const item = record(value, "activeShift");
  return {
    shiftId: uuid(item.shiftId, "activeShift.shiftId"),
    startsAt: timestamp(item.startsAt, "activeShift.startsAt"),
    endsAt: timestamp(item.endsAt, "activeShift.endsAt"),
  };
}

export function decodeConditionsSnapshot(
  data: string,
): ConditionsDecodeResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new InvalidConditionsPayloadError("$", "valid JSON");
  }

  const snapshot = record(parsed, "$");
  const decodedConditions = conditions(snapshot.conditions);

  return {
    snapshot: {
      siteId: uuid(snapshot.siteId, "siteId"),
      conditions: decodedConditions.payload,
      lightning: lightning(snapshot.lightning),
      activeShift: activeShift(snapshot.activeShift),
      asOf: timestamp(snapshot.asOf, "asOf"),
    },
    warnings: decodedConditions.warnings,
  };
}
