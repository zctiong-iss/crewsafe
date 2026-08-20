/** @author Tang Chee Seng (with assistance from Claude) */
// Key Purpose: runtime validation boundary for the action-dispatch stream. Every field the UI
// reads is proven to be the right shape here, so nothing downstream has to guard against a
// malformed frame — a bad payload is rejected at the door and degrades the stream instead.

import type {
  ActionDispatch,
  ActionDispatchStatus,
  AlertCounts,
  CompletedBy,
} from "./actionStatusStream";

export class InvalidActionStatusPayloadError extends Error {
  constructor(path: string, expected: string) {
    super(`Invalid action-status payload at ${path}: expected ${expected}`);
    this.name = "InvalidActionStatusPayloadError";
  }
}

// UUID: xxxxxxxx-xxxx-Vxxx-Wxxx-xxxxxxxxxxxx
// V = version 1–8; W = RFC variant 8, 9, a, or b
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DISPATCH_STATUSES: readonly ActionDispatchStatus[] = [
  "PENDING",
  "LATE",
  "ACKNOWLEDGED",
  "COMPLETED",
  "CANCELLED",
];
const COMPLETED_BY_VALUES: readonly CompletedBy[] = ["WORKER", "SYSTEM"];

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidActionStatusPayloadError(path, "object");
  }
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidActionStatusPayloadError(path, "non-empty string");
  }
  return value;
}
// Free-text fields (instruction) may legitimately be empty; only null is meaningfully "absent".
function freeText(value: unknown, path: string): string {
  if (typeof value !== "string") throw new InvalidActionStatusPayloadError(path, "string");
  return value;
}
function uuid(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!UUID_PATTERN.test(parsed)) throw new InvalidActionStatusPayloadError(path, "UUID");
  return parsed;
}
function timestamp(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new InvalidActionStatusPayloadError(path, "ISO-8601 timestamp");
  }
  return parsed;
}
function finiteNumber(value: unknown, path: string, minimum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidActionStatusPayloadError(path, "finite number");
  }
  if (minimum !== undefined && value < minimum) {
    throw new InvalidActionStatusPayloadError(path, `number >= ${minimum}`);
  }
  return value;
}
function member<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new InvalidActionStatusPayloadError(path, values.join(" | "));
  }
  return value as T;
}

/** Decodes one `action-status` frame (an ActionDispatchResponse) into a proven ActionDispatch. */
export function decodeActionDispatch(data: string): ActionDispatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new InvalidActionStatusPayloadError("$", "valid JSON");
  }

  const item = record(parsed, "$");
  return {
    id: uuid(item.id, "id"),
    recommendationId: uuid(item.recommendationId, "recommendationId"),
    approvalId: item.approvalId == null ? null : uuid(item.approvalId, "approvalId"),
    workerId: uuid(item.workerId, "workerId"),
    actionCode: string(item.actionCode, "actionCode"),
    instruction: item.instruction == null ? null : freeText(item.instruction, "instruction"),
    startTime: item.startTime == null ? null : timestamp(item.startTime, "startTime"),
    endTime: item.endTime == null ? null : timestamp(item.endTime, "endTime"),
    status: member(item.status, DISPATCH_STATUSES, "status"),
    dispatchedAt: timestamp(item.dispatchedAt, "dispatchedAt"),
    lateAt: item.lateAt == null ? null : timestamp(item.lateAt, "lateAt"),
    completedBy:
      item.completedBy == null ? null : member(item.completedBy, COMPLETED_BY_VALUES, "completedBy"),
  };
}

/** Decodes one `alert-count` frame (an AlertCountResponse) into proven counts. */
export function decodeAlertCount(data: string): AlertCounts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new InvalidActionStatusPayloadError("$", "valid JSON");
  }

  const item = record(parsed, "$");
  return {
    siteId: uuid(item.siteId, "siteId"),
    pending: finiteNumber(item.pending, "pending", 0),
    late: finiteNumber(item.late, "late", 0),
    acknowledged: finiteNumber(item.acknowledged, "acknowledged", 0),
    completed: finiteNumber(item.completed, "completed", 0),
    asOf: timestamp(item.asOf, "asOf"),
  };
}
