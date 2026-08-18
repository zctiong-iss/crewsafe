import type { PolicyVersion } from "@/types/domain";

const LEGACY_FIELD = "wbgtEmergencyStop";

/** Compatibility-only policy field retained by the API while WBGT enforcement ignores it. */
export function emergencyStopCompatibilityValue(version: PolicyVersion): number {
  const value = Reflect.get(version, LEGACY_FIELD);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}
