/**
 * Approved-action dispatch (SCRUM-186).
 *
 * Unlike the safety endpoints, these are REAL — `ActionDispatchController` implements all
 * of them. Only `mock` auth mode diverges, and only because there is no backend to talk to
 * in that mode. The shape of the call is the same either way.
 *
 * Two things about this controller are worth knowing before reading the slice:
 *
 * 1. It is mounted at `/api/action-dispatch`, not `/api/v1/...`. The rest of the API is
 *    versioned; this one is not. Left as-is — changing it is a backend concern.
 *
 * 2. `GET .../pending` returns PENDING rows only. An acknowledged action vanishes from the
 *    server's answer, which is why the client keeps its own record of what it has
 *    acknowledged — SCRUM-186 requires "clear acknowledged / pending states", and the
 *    server cannot supply the acknowledged half.
 */
import { request } from "../client";
import { isMockApi } from "@/auth/authMode";
import { mockAcknowledge, mockPendingDispatches } from "../mock/dispatch";
import type { ActionDispatch } from "@/types/domain";

const MOCK_LATENCY_MS = 400;

function delay<T>(produce: () => T): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(produce());
      } catch (error) {
        reject(error);
      }
    }, MOCK_LATENCY_MS),
  );
}

/** `GET /api/action-dispatch/worker/{workerId}/pending` — WORKER only, own dispatches only. */
export function fetchPendingDispatches(workerId: string): Promise<ActionDispatch[]> {
  if (isMockApi()) return delay(() => mockPendingDispatches(workerId));

  return request<ActionDispatch[]>({
    url: `/api/action-dispatch/worker/${workerId}/pending`,
    method: "GET",
  });
}

/**
 * `POST /api/action-dispatch/{dispatchId}/acknowledge`
 *
 * ── ABOUT THE IDEMPOTENCY KEY ───────────────────────────────────────────────────────────
 * The header is sent on every attempt and the backend does not currently read it. That is
 * not an oversight on either side:
 *
 *   • The acceptance criterion already holds. `ActionDispatchService.acknowledgeDispatch`
 *     returns early when the status is already ACKNOWLEDGED — and it returns *before*
 *     `auditService.record`, so a replay produces neither a second state change nor a
 *     second audit event. Exactly one acknowledgement, server-side, today.
 *
 *   • The key is still required. SCRUM-186 says so explicitly, and the reason is SCRUM-130:
 *     an offline queue replays writes long after the fact, possibly across a reinstall, and
 *     state-based idempotency only works while the client is asking about a row that still
 *     exists in the state it remembers. A key that was generated and persisted at the
 *     moment of the tap is what makes that replay safe. Skipping it now would mean
 *     retrofitting one later onto queued items that never had one.
 *
 * `Idempotency-Key` is already on the backend's CORS allow-list (`SecurityConfig`), so the
 * header reaches the server and is simply ignored until someone consumes it.
 */
export function acknowledgeDispatch(
  dispatchId: string,
  idempotencyKey: string,
): Promise<ActionDispatch> {
  if (isMockApi()) return delay(() => mockAcknowledge(dispatchId, idempotencyKey));

  return request<ActionDispatch>({
    url: `/api/action-dispatch/${dispatchId}/acknowledge`,
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
  });
}
