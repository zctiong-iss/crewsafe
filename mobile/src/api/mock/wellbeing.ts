/**
 * Rest, hydration and concerns for `mock` auth mode (US-11).
 *
 * Seeded with a little history rather than starting empty: a supervisor screen whose only state
 * anyone ever reviews is the empty one is a screen nobody has actually looked at. One worker has
 * been drinking and resting, one has an open concern, and one has logged nothing at all — which
 * is the row the crew view most needs to render legibly, because it is the one worth acting on.
 *
 * @author Justin Chua
 */
import { ApiError } from "../errors";
import { mockListShifts } from "./shifts";
import { DEMO_SITES } from "@/auth/demoUsers";
import type { ConcernInput } from "../endpoints/wellbeing";
import type {
  Concern,
  CrewWellbeingRow,
  WellbeingLog,
  WellbeingLogType,
} from "@/types/domain";

let sequence = 0;
const nextId = (prefix: string) =>
  `${prefix}0000${(++sequence).toString(16)}-0000-4000-8000-00000000000${sequence.toString(16)}`;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/** The workers on the demo site's running shift, in the order the fixtures define them. */
function runningShift() {
  return mockListShifts(DEMO_SITES.bishan.id).find((shift) => shift.status === "ACTIVE") ?? null;
}

let logStore: WellbeingLog[] | null = null;
let concernStore: Concern[] | null = null;

/*
 * Built lazily. Shift ids are generated when `mock/shifts` initialises, so a log cannot name one
 * at import time — doing this eagerly attached everything to an empty shift list.
 */
function seed(): { logs: WellbeingLog[]; concerns: Concern[] } {
  const shift = runningShift();
  if (!shift) return { logs: [], concerns: [] };

  const [first, second] = shift.assignments;
  const logs: WellbeingLog[] = [];
  const concerns: Concern[] = [];

  if (first) {
    logs.push(
      { id: nextId("wl"), shiftId: shift.id, logType: "HYDRATION", source: "SELF", loggedAt: minutesAgo(18) },
      { id: nextId("wl"), shiftId: shift.id, logType: "HYDRATION", source: "SELF", loggedAt: minutesAgo(74) },
      // Tagged INSTRUCTED: this one came from a dispatched rest that ran to completion, and the
      // supervisor view has to show it differently from a rest the worker chose to take.
      { id: nextId("wl"), shiftId: shift.id, logType: "REST", source: "INSTRUCTED", loggedAt: minutesAgo(96) },
    );
  }

  if (second) {
    concerns.push({
      id: nextId("cn"),
      shiftId: shift.id,
      workerId: second.workerId,
      symptoms: ["DIZZINESS", "HEADACHE"],
      note: "Been light-headed since the last break.",
      status: "OPEN",
      raisedAt: minutesAgo(9),
      acknowledgedAt: null,
    });
  }

  return { logs, concerns };
}

function stores() {
  if (logStore === null || concernStore === null) {
    const seeded = seed();
    logStore = seeded.logs;
    concernStore = seeded.concerns;
  }
  return { logs: logStore, concerns: concernStore };
}

/** Deep-copied out: Redux freezes what it receives, after which the mock cannot write to it. */
const copyConcern = (concern: Concern): Concern => ({ ...concern, symptoms: [...concern.symptoms] });

export function mockLogWellbeing(shiftId: string, logType: WellbeingLogType): WellbeingLog {
  const log: WellbeingLog = {
    id: nextId("wl"),
    shiftId,
    logType,
    source: "SELF",
    loggedAt: new Date().toISOString(),
  };
  stores().logs.unshift(log);
  return { ...log };
}

export function mockRaiseConcern(shiftId: string, input: ConcernInput): Concern {
  const hasSymptom = input.symptoms.some((symptom) => symptom !== "NONE");
  const hasNote = Boolean(input.note?.trim());
  if (!hasSymptom && !hasNote) {
    // Mirrors the server: an empty concern says nothing a supervisor can act on, but still costs
    // them the trip to look at it.
    throw new ApiError("bad-request", "A concern needs at least one symptom or a note", 400, null);
  }

  const concern: Concern = {
    id: nextId("cn"),
    shiftId,
    // The demo worker's own id — the real endpoint takes this from the token, never the body.
    workerId: "aaaaaaaa-0000-4000-8000-000000000001",
    symptoms: [...input.symptoms],
    note: input.note?.trim() ? input.note.trim() : null,
    status: "OPEN",
    raisedAt: new Date().toISOString(),
    acknowledgedAt: null,
  };
  stores().concerns.unshift(concern);
  return copyConcern(concern);
}

/** Folds the log list the same way the server does, so the mock cannot disagree about "latest". */
export function mockCrewWellbeing(shiftId: string): CrewWellbeingRow[] {
  const shift = runningShift();
  const forShift = stores().logs.filter((log) => log.shiftId === shiftId);
  if (!shift || forShift.length === 0) return [];

  // Mock logs carry no workerId (the server derives it from the token), so they are attributed to
  // the first worker on the shift — enough to exercise the "some logged, some did not" rendering
  // the screen has to get right.
  const workerId = shift.assignments[0]?.workerId;
  if (!workerId) return [];

  const byType = (type: WellbeingLogType) =>
    forShift
      .filter((log) => log.logType === type)
      .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));

  const rests = byType("REST");
  const drinks = byType("HYDRATION");

  return [
    {
      workerId,
      lastRestAt: rests[0]?.loggedAt ?? null,
      lastRestSource: rests[0]?.source ?? null,
      lastHydrationAt: drinks[0]?.loggedAt ?? null,
      restCount: rests.length,
      hydrationCount: drinks.length,
    },
  ];
}

export function mockSiteConcerns(): Concern[] {
  return stores().concerns.map(copyConcern);
}

export function mockAcknowledgeConcern(concernId: string): Concern {
  const found = stores().concerns.find((concern) => concern.id === concernId);
  if (!found) {
    throw new ApiError("not-found", "No such concern", 404, null);
  }
  if (found.status === "ACKNOWLEDGED") {
    throw new ApiError("conflict", "This concern is already acknowledged", 409, null);
  }

  found.status = "ACKNOWLEDGED";
  found.acknowledgedAt = new Date().toISOString();
  return copyConcern(found);
}

/** Test seam — lets a test start clean rather than inheriting another test's writes. */
export function resetMockWellbeing(): void {
  logStore = null;
  concernStore = null;
  sequence = 0;
}
