/**
 * A stand-in dispatch server that actually enforces idempotency.
 *
 * ── WHY THIS IS MORE THAN A FIXTURE ─────────────────────────────────────────────────────
 * SCRUM-186's acceptance is "killing the network mid-acknowledgement and retrying produces
 * exactly one acknowledgement server-side". You cannot demonstrate that against a fixture
 * that returns a canned object — the interesting behaviour is what the *server* does with a
 * repeated key, so this mock keeps a ledger and applies the rule.
 *
 * `LEDGER` is keyed by idempotency key, not by dispatch id. That is the whole point: a
 * second request carrying a key that has been seen returns the first result unchanged and
 * records nothing new. `acknowledgementCount()` exposes the ledger size so the screen can
 * show that it stays at 1 across any number of retries — a claim that is otherwise
 * untestable by hand.
 *
 * `simulateLostResponse` reproduces the exact failure the story cares about: the server
 * commits the acknowledgement and *then* the response is lost. The client sees a network
 * error and has no way to know the write succeeded — which is precisely why replaying the
 * same key has to be safe.
 *
 * The real endpoints exist (`ActionDispatchController`), so this runs only in `mock` auth
 * mode. See `endpoints/dispatch.ts`.
 *
 * @author Justin Chua
 */
import { ApiError } from "../errors";
import type { ActionDispatch } from "@/types/domain";
import { DEMO_USERS } from "@/auth/demoUsers";

interface LedgerEntry {
  dispatchId: string;
  acknowledgedAt: string;
}

/** Keyed by idempotency key. Survives for the app session, like a server would. */
const LEDGER = new Map<string, LedgerEntry>();

let lostResponseEnabled = false;

export function setSimulateLostResponse(enabled: boolean): void {
  if (!__DEV__) return;
  lostResponseEnabled = enabled;
}

export function getSimulateLostResponse(): boolean {
  return lostResponseEnabled;
}

/** How many acknowledgements the "server" has actually recorded. Must stay 1 per dispatch. */
export function acknowledgementCount(dispatchId: string): number {
  let count = 0;
  for (const entry of LEDGER.values()) {
    if (entry.dispatchId === dispatchId) count += 1;
  }
  return count;
}

const WORKER_ID = DEMO_USERS[0].id;
const APPROVAL_ID = "44444444-4444-4444-8444-444444444444";

/**
 * ── THE SEED NOW SENDS WHAT A REAL SERVER SENDS ─────────────────────────────────────────
 * This mock used to hold a translation KEY per dispatch and resolve it per read, standing in
 * for a server that localised its own instructions. It read well and it hid the bug.
 *
 * Live plans come from Bedrock, which writes `action` as free prose — the sentence a worker
 * received was whatever the model composed, in English, matching no key anywhere. But the demo
 * route resolved its own keys and rendered perfectly in all seven languages, so every
 * screenshot taken against the mock showed a working screen while the live path was broken.
 * A fixture that cannot reproduce the defect is worse than no fixture.
 *
 * So the seed now carries exactly what the wire carries: the server's ENGLISH text plus the
 * `instructionCode` that `InstructionCatalogue` resolves server-side. Translation happens where
 * it happens in production — in the card, from the code — and the demo exercises the same path
 * as local and live.
 *
 * The `dev.mockInstruction.*` keys are left in the locale files. They cost nothing and the
 * bespoke wording is the right fixture for the verbatim path if this seed ever needs it back.
 */
type SeedDispatch = ActionDispatch;

/**
 * Codes drawn from the catalogue named in `V3__domain_schema.sql`: "a growing catalog of
 * dispatchable actions (REST_10_MIN, REST_15_MIN, HYDRATE, STOP_WORK, ...)". Deliberately
 * not an enum server-side, so the client must tolerate an unknown one.
 */
const SEED: SeedDispatch[] = [
  {
    id: "d1111111-1111-4111-8111-111111111111",
    approvalId: APPROVAL_ID,
    workerId: WORKER_ID,
    actionCode: "REST_15_MIN",
    // The server's English, verbatim from `DeterministicPlanBuilder.ACTION_TEXT`...
    instruction: "Take a 15-minute rest break in shade every hour",
    // ...and the code the card actually translates from. Note it is NOT `actionCode`:
    // REST_15_MIN is the collapsed dispatch form and has no sentence of its own.
    instructionCode: "REST_15_MIN_HOURLY",
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  },
  {
    id: "d2222222-2222-4222-8222-222222222222",
    approvalId: APPROVAL_ID,
    workerId: WORKER_ID,
    actionCode: "HYDRATE",
    /*
     * The case that rules out keying on `actionCode` altogether. HYDRATE_HOURLY and
     * HYDRATE_REGULARLY both dispatch as HYDRATE, and they say different things about how
     * often to drink -- so this seed is only unambiguous because of `instructionCode`.
     */
    instruction: "Drink water regularly throughout the shift",
    instructionCode: "HYDRATE_REGULARLY",
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  },
  {
    id: "d3333333-3333-4333-8333-333333333333",
    approvalId: APPROVAL_ID,
    workerId: WORKER_ID,
    /*
     * Translated as of SCRUM-205. It was left out of the catalogue deliberately at first, to
     * prove the card degrades to `humaniseActionCode` rather than rendering an empty row —
     * but a real catalogue code showing in English on a localised screen is too high a price
     * for a demonstration. The fallback still guards every code the backend adds ahead of
     * this app's translations, which is the case it actually exists for, and
     * `humaniseActionCode` has its own unit-level coverage.
     */
    actionCode: "ROTATE_TO_LIGHT_DUTY",
    instruction: "Rotate affected workers onto lighter duties",
    instructionCode: "ROTATE_TO_LIGHT_DUTY",
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: new Date(Date.now() - 41 * 60_000).toISOString(),
  },
];

const dispatches = new Map<string, SeedDispatch>(SEED.map((d) => [d.id, { ...d }]));

/**
 * Seed record → the wire shape.
 *
 * A pass-through copy now that the seed holds the wire shape itself. Kept rather than inlined
 * because every read goes through it, which is the one place to reproduce a server-side quirk
 * if one ever needs reproducing.
 */
function materialise(seed: SeedDispatch): ActionDispatch {
  return { ...seed };
}

/**
 * Mirrors `findPendingByWorkerId`, PENDING filter included.
 *
 * The real query really does return only PENDING rows, so an acknowledged action disappears
 * from the server's answer entirely. Reproducing that here rather than quietly returning
 * everything is what forces the client to solve it properly — see the inbox slice.
 */
/*
 * ── EVERY READ RETURNS COPIES ───────────────────────────────────────────────────────────
 * This is not defensive style, it is a correctness requirement, and getting it wrong
 * produced a genuinely confusing bug: acknowledging always failed on the first tap and
 * succeeded on the second.
 *
 * A real HTTP client deserializes a fresh object per response, so nothing the server holds
 * can ever be reached by the caller. A mock that hands back its own objects breaks that
 * assumption. Those objects go into Redux, where Immer deep-freezes state in development —
 * so the mock's own store silently becomes read-only. The next write threw
 * `TypeError: Cannot assign to read only property`, which is not an `ApiError`, so it
 * surfaced as the generic "Something went wrong" rather than anything diagnosable.
 *
 * It failed only on the *first* tap because the ledger entry was written before the throw,
 * so the retry took the replay branch and returned without writing. The idempotency demo
 * still looked correct, which is what made it hard to spot.
 */
export function mockPendingDispatches(workerId: string): ActionDispatch[] {
  return [...dispatches.values()]
    .filter((d) => d.workerId === workerId && d.status === "PENDING")
    .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt))
    .map(materialise);
}

export function mockAcknowledge(dispatchId: string, idempotencyKey: string): ActionDispatch {
  const existing = dispatches.get(dispatchId);
  if (!existing) {
    throw new ApiError("not-found", "No such dispatch", 404, null);
  }

  const seen = LEDGER.get(idempotencyKey);

  if (seen) {
    // Replay. Nothing is written; the original result is returned. This is the branch the
    // acceptance criterion exercises.
    return materialise(existing);
  }

  const acknowledgedAt = new Date().toISOString();
  LEDGER.set(idempotencyKey, { dispatchId, acknowledgedAt });

  // Replaced rather than mutated. Even if a reference did escape into frozen state, this
  // writes a new object into the Map instead of assigning through the old one — so the
  // store cannot be poisoned by whatever a caller did with a previous response.
  const updated: SeedDispatch = {
    ...existing,
    status: "ACKNOWLEDGED",
    startTime: acknowledgedAt,
  };
  dispatches.set(dispatchId, updated);

  if (lostResponseEnabled) {
    // Committed above, then the response never arrives. The client cannot distinguish this
    // from "never processed", which is the reason idempotency keys exist at all.
    throw new ApiError("network", "Response lost after the server committed", null, null);
  }

  return materialise(updated);
}

/** Dev only: put the seed data back so the flow can be run again without a reload. */
export function resetMockDispatches(): void {
  if (!__DEV__) return;
  LEDGER.clear();
  dispatches.clear();
  for (const d of SEED) dispatches.set(d.id, { ...d });
}

/**
 * Completing a dispatch in mock mode (US-11).
 *
 * Idempotent like the server: a rest timer that expires while a retry is already in flight must
 * not produce two completions, and the real endpoint returns the existing row rather than
 * failing.
 */
export function mockComplete(dispatchId: string): ActionDispatch {
  const found = dispatches.get(dispatchId);
  if (!found) {
    throw new ApiError("not-found", "No such dispatch", 404, null);
  }
  found.status = "COMPLETED";
  found.endTime = new Date().toISOString();
  return materialise(found);
}
