/**
 * A stand-in shift service.
 *
 * Unlike the weather and lightning mocks, `ShiftController` is REAL and complete — this
 * exists only because `mock` auth mode has no backend to talk to. It therefore mirrors the
 * controller's actual behaviour rather than inventing a convenient one:
 *
 *   • `listShifts` returns most-recently-created first. The response carries no `createdAt`,
 *     so a client cannot reproduce that order — it has to trust the server's. The mock keeps
 *     insertion order and reverses it, so a client that wrongly re-sorts would show up here.
 *   • Every shift is created PLANNED. `ShiftStatus` is server-controlled and the contract is
 *     explicit that a client cannot set it.
 *   • Deleting a shift removes its assignments too.
 *   • A site the caller does not belong to is a 403, never a 404 — see `forceForbidden`.
 */
import { ApiError } from "../errors";
import { DEMO_SITES } from "@/auth/demoUsers";
import type { Shift, ShiftAssignment, SiteWorker } from "@/types/domain";

/**
 * Dev switch for the cross-site 403 that SCRUM-161 names explicitly.
 *
 * It is otherwise unreachable from the UI: the site picker only offers sites the user
 * belongs to, so the only way to hit a real 403 is to have membership revoked mid-session.
 * That is exactly the case worth being able to see on demand.
 */
let forbidden = false;

export function setForceForbidden(enabled: boolean): void {
  if (!__DEV__) return;
  forbidden = enabled;
}

export function getForceForbidden(): boolean {
  return forbidden;
}

function assertAllowed(): void {
  if (forbidden) {
    throw new ApiError("forbidden", "Access denied", 403, "mock-request-id");
  }
}

/**
 * A site's assignable workers.
 *
 * More than the demo logins on purpose: a real site has a crew, only a couple of whom are
 * accounts anyone signs in with. A picker that offered exactly the three demo users would
 * hide every layout problem a twenty-name list creates.
 */
const SITE_WORKERS: Record<string, SiteWorker[]> = {
  [DEMO_SITES.bishan.id]: [
    { id: "aaaaaaaa-0000-4000-8000-000000000001", displayName: "Synthetic Worker" },
    { id: "w0000001-0000-4000-8000-00000000000a", displayName: "Arun Balakrishnan" },
    { id: "w0000002-0000-4000-8000-00000000000b", displayName: "Chen Wei Ming" },
    { id: "w0000003-0000-4000-8000-00000000000c", displayName: "Mohammad Rizwan bin Salleh" },
    { id: "w0000004-0000-4000-8000-00000000000d", displayName: "Devi Rajaratnam" },
    { id: "w0000005-0000-4000-8000-00000000000e", displayName: "Tan Boon Huat" },
  ],
  [DEMO_SITES.campus.id]: [
    { id: "w0000006-0000-4000-8000-00000000000f", displayName: "Kavitha Subramaniam" },
    { id: "w0000007-0000-4000-8000-000000000010", displayName: "Lim Jia Hao" },
  ],
};

let sequence = 0;
const nextId = (prefix: string) =>
  `${prefix}${(sequence++).toString().padStart(8, "0")}-0000-4000-8000-000000000000`.slice(0, 36);

function seedShift(
  siteId: string,
  startsAt: string,
  endsAt: string,
  status: Shift["status"],
  assignments: Omit<ShiftAssignment, "id">[],
): Shift {
  return {
    id: nextId("s"),
    siteId,
    startsAt,
    endsAt,
    status,
    assignments: assignments.map((a) => ({ ...a, id: nextId("a") })),
  };
}

const now = Date.now();
const hours = (n: number) => new Date(now + n * 3_600_000).toISOString();

/** Insertion order is oldest-created first; `listShifts` reverses it. */
const shifts: Shift[] = [
  seedShift(DEMO_SITES.bishan.id, hours(-26), hours(-18), "CLOSED", [
    {
      workerId: "w0000002-0000-4000-8000-00000000000b",
      taskName: "Hedge trimming, north path",
      intensity: "MODERATE",
      acclimatisationDay: null,
    },
  ]),
  seedShift(DEMO_SITES.bishan.id, hours(-2), hours(5), "ACTIVE", [
    {
      workerId: "aaaaaaaa-0000-4000-8000-000000000001",
      taskName: "Kerb laying, east verge",
      intensity: "HEAVY",
      acclimatisationDay: 3,
    },
    {
      workerId: "w0000001-0000-4000-8000-00000000000a",
      taskName: "Kerb laying, east verge",
      intensity: "HEAVY",
      acclimatisationDay: null,
    },
    {
      workerId: "w0000004-0000-4000-8000-00000000000d",
      // Null task: the contract allows it, so the detail view must render it rather than
      // showing an empty row.
      taskName: null,
      intensity: "LIGHT",
      acclimatisationDay: null,
    },
  ]),
  // A shift with no assignments at all. The contract is explicit that one may be created
  // empty and staffed later, so the list and detail both have to handle it.
  seedShift(DEMO_SITES.bishan.id, hours(22), hours(30), "PLANNED", []),
];

/**
 * Deep-copied on the way out, for the reason spelled out in `api/mock/dispatch.ts`: a real
 * HTTP client deserializes a fresh object per response, and handing back the store's own
 * objects lets Immer freeze them once they reach Redux — after which the mock can no longer
 * write to its own data. Nothing mutates a shift today, so this has not bitten here; it is
 * copied anyway so that the first person to add an update does not rediscover it the hard
 * way.
 */
function copyShift(shift: Shift): Shift {
  return { ...shift, assignments: shift.assignments.map((a) => ({ ...a })) };
}

export function mockListShifts(siteId: string): Shift[] {
  assertAllowed();
  // Most recently created first, matching the controller. Never sorted by start time — the
  // server's order is the contract, and the response has no field to reconstruct it from.
  return shifts
    .filter((s) => s.siteId === siteId)
    .reverse()
    .map(copyShift);
}

export function mockGetShift(siteId: string, shiftId: string): Shift {
  assertAllowed();
  const shift = shifts.find((s) => s.id === shiftId && s.siteId === siteId);
  if (!shift) throw new ApiError("not-found", "No such shift under this site", 404, null);
  return copyShift(shift);
}

export function mockListSiteWorkers(siteId: string): SiteWorker[] {
  assertAllowed();
  return [...(SITE_WORKERS[siteId] ?? [])].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export function mockDeleteShift(siteId: string, shiftId: string): void {
  assertAllowed();
  const index = shifts.findIndex((s) => s.id === shiftId && s.siteId === siteId);
  if (index === -1) throw new ApiError("not-found", "No such shift under this site", 404, null);
  // Removes the shift and every assignment on it, as the contract says.
  shifts.splice(index, 1);
}

/** Used by step 7's create form. Server-controlled status: always PLANNED. */
export function mockCreateShift(
  siteId: string,
  startsAt: string,
  endsAt: string,
  assignments: Omit<ShiftAssignment, "id">[],
): Shift {
  assertAllowed();
  const created = seedShift(siteId, startsAt, endsAt, "PLANNED", assignments);
  shifts.push(created);
  return copyShift(created);
}
