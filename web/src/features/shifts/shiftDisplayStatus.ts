import type { Shift } from "@/api/shifts";

/** A display-only status derived from the authoritative shift payload and the current time. */
export type DisplayStatus = Shift["status"] | "ENDED";

export function displayStatus(shift: Shift, now = new Date()): DisplayStatus {
  if (shift.status === "CLOSED" || shift.status === "CANCELLED") return shift.status;
  if (new Date(shift.endsAt) <= now) return "ENDED";
  if (new Date(shift.startsAt) <= now) return "ACTIVE";
  return "PLANNED";
}
