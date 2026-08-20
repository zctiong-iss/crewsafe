/** Runtime validation boundary for the supervisor concern stream. */

import type { Concern, ConcernSymptom } from "./concernStream";

export class InvalidConcernPayloadError extends Error {
  constructor(path: string, expected: string) {
    super(`Invalid concern payload at ${path}: expected ${expected}`);
    this.name = "InvalidConcernPayloadError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONCERN_SYMPTOMS: readonly ConcernSymptom[] = [
  "NONE",
  "DIZZINESS",
  "NAUSEA",
  "HEADACHE",
  "FATIGUE",
  "MUSCLE_CRAMPS",
  "OTHER",
];

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidConcernPayloadError(path, "object");
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidConcernPayloadError(path, "non-empty string");
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (!UUID_PATTERN.test(parsed)) throw new InvalidConcernPayloadError(path, "UUID");
  return parsed;
}

function timestamp(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new InvalidConcernPayloadError(path, "ISO-8601 timestamp");
  }
  return parsed;
}

function symptoms(value: unknown, path: string): ConcernSymptom[] {
  if (!Array.isArray(value)) throw new InvalidConcernPayloadError(path, "array of strings");
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const parsed = nonEmptyString(item, itemPath);
    if (!CONCERN_SYMPTOMS.includes(parsed as ConcernSymptom)) {
      throw new InvalidConcernPayloadError(itemPath, CONCERN_SYMPTOMS.join(" | "));
    }
    return parsed as ConcernSymptom;
  });
}

function optionalText(value: unknown, path: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new InvalidConcernPayloadError(path, "string or null");
  return value;
}

/** Decode the complete newest-first OPEN concern snapshot emitted by the server. */
export function decodeConcernSnapshot(data: string): Concern[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new InvalidConcernPayloadError("$", "valid JSON");
  }

  if (!Array.isArray(parsed)) throw new InvalidConcernPayloadError("$", "array");
  return parsed.map((value, index) => {
    const item = record(value, `$[${index}]`);
    const status = nonEmptyString(item.status, `$[${index}].status`);
    if (status !== "OPEN") throw new InvalidConcernPayloadError(`$[${index}].status`, "OPEN");
    if (item.acknowledgedAt != null) {
      throw new InvalidConcernPayloadError(`$[${index}].acknowledgedAt`, "null for OPEN concern");
    }
    return {
      id: uuid(item.id, `$[${index}].id`),
      shiftId: uuid(item.shiftId, `$[${index}].shiftId`),
      workerId: uuid(item.workerId, `$[${index}].workerId`),
      symptoms: symptoms(item.symptoms, `$[${index}].symptoms`),
      note: optionalText(item.note, `$[${index}].note`),
      status: "OPEN" as const,
      raisedAt: timestamp(item.raisedAt, `$[${index}].raisedAt`),
      acknowledgedAt: null,
    } satisfies Concern;
  });
}
