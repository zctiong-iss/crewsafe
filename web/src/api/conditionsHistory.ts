import { apiFetch } from "./client";
import { isWbgtWithinSanityRange } from "./conditionsDecoder";

export interface ConditionsHistoryPoint {
  observedAt: string;
  wbgt: number;
}

export interface ConditionsHistory {
  from: string;
  asOf: string;
  points: ConditionsHistoryPoint[];
}

export class InvalidConditionsHistoryPayloadError extends Error {
  constructor(path: string, expected: string) {
    super(`Invalid conditions history payload at ${path}: expected ${expected}`);
    this.name = "InvalidConditionsHistoryPayloadError";
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidConditionsHistoryPayloadError(path, "object");
  }
  return value as Record<string, unknown>;
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new InvalidConditionsHistoryPayloadError(path, "ISO-8601 timestamp");
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidConditionsHistoryPayloadError(path, "finite number");
  }
  return value;
}

export function decodeConditionsHistory(value: unknown): ConditionsHistory {
  const envelope = record(value, "$");
  if (!Array.isArray(envelope.points)) {
    throw new InvalidConditionsHistoryPayloadError("points", "array");
  }

  const points = envelope.points
    .map((value, index) => {
      const point = record(value, `points[${index}]`);
      return {
        observedAt: timestamp(point.observedAt, `points[${index}].observedAt`),
        wbgt: finiteNumber(point.wbgt, `points[${index}].wbgt`),
      };
    })
    .filter((point) => isWbgtWithinSanityRange(point.wbgt));

  return {
    from: timestamp(envelope.from, "from"),
    asOf: timestamp(envelope.asOf, "asOf"),
    points,
  };
}

export async function fetchConditionsHistory(
  siteId: string,
  signal?: AbortSignal,
): Promise<ConditionsHistory> {
  const value = await apiFetch<unknown>(
    `/api/v1/sites/${siteId}/conditions/history`,
    { signal },
  );
  return decodeConditionsHistory(value);
}
