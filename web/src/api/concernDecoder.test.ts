import { describe, expect, it } from "vitest";
import { decodeConcernSnapshot, InvalidConcernPayloadError } from "./concernDecoder";

const concern = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  shiftId: "550e8400-e29b-41d4-a716-446655440002",
  workerId: "550e8400-e29b-41d4-a716-446655440003",
  symptoms: ["DIZZINESS", "MUSCLE_CRAMPS"],
  note: "I need help",
  status: "OPEN",
  raisedAt: "2026-08-20T08:00:00Z",
  acknowledgedAt: null,
};

describe("decodeConcernSnapshot", () => {
  it("accepts a complete open concern snapshot and preserves order", () => {
    expect(decodeConcernSnapshot(JSON.stringify([concern]))).toEqual([concern]);
    expect(decodeConcernSnapshot("[]")).toEqual([]);
  });

  it.each([
    ["not JSON", "valid JSON"],
    [JSON.stringify({ ...concern }), "array"],
    [JSON.stringify([{ ...concern, id: "bad" }]), "UUID"],
    [JSON.stringify([{ ...concern, status: "ACKNOWLEDGED" }]), "OPEN"],
    [JSON.stringify([{ ...concern, raisedAt: "yesterday" }]), "ISO-8601"],
    [JSON.stringify([{ ...concern, symptoms: [3] }]), "non-empty string"],
    [JSON.stringify([{ ...concern, symptoms: ["FEVER"] }]), "DIZZINESS"],
    [JSON.stringify([{ ...concern, acknowledgedAt: "2026-08-20T08:01:00Z" }]), "null"],
  ])("rejects malformed payload (%s)", (payload) => {
    expect(() => decodeConcernSnapshot(payload)).toThrow(InvalidConcernPayloadError);
  });
});
