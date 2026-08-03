/**
 * The approved-action inbox (SCRUM-186).
 *
 * ── TWO THINGS THIS SLICE PERSISTS, AND WHY ─────────────────────────────────────────────
 *
 * `idempotencyKeys`  One UUIDv4 per dispatch, minted on the first acknowledgement attempt
 *                    and reused by every retry. Persisted so it survives the app being
 *                    killed mid-request — which is exactly the case the key exists for. A
 *                    key held only in memory would be regenerated on relaunch, and the
 *                    replay would look like a fresh acknowledgement to any server that
 *                    keyed on it.
 *
 * `acknowledged`     What this device has successfully acknowledged, and when. Needed
 *                    because `GET .../pending` returns PENDING rows only: an acknowledged
 *                    action disappears from the server's answer entirely. Without a local
 *                    record the card would simply vanish on success, and SCRUM-186 asks for
 *                    "clear acknowledged / pending states" — a state you cannot see is not
 *                    a clear one.
 *
 * Both are the groundwork SCRUM-130 (offline queueing) builds on. That story is out of
 * scope here, but the ticket is explicit that the key must not be skipped now, because
 * retrofitting one onto already-queued items is not possible.
 */
import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import * as Crypto from "expo-crypto";
import { acknowledgeDispatch, fetchPendingDispatches } from "@/api/endpoints/dispatch";
import { isApiError, messageKeyFor, type ApiError } from "@/api/errors";
import type { ActionDispatch } from "@/types/domain";
import type { RootState } from "../store";

export type InboxStatus = "idle" | "loading" | "ready" | "error";

export interface AcknowledgementRecord {
  acknowledgedAt: string;
  /** The key that produced it. Kept for audit and for SCRUM-130's replay. */
  idempotencyKey: string;
  /**
   * A copy of the action as it was when acknowledged.
   *
   * Not redundant with `pending`: the moment this succeeds the server stops returning the
   * row from `GET .../pending`, so without a snapshot the card would simply disappear at
   * the instant of success. Keeping it is what lets the acknowledged state be *shown*
   * rather than merely recorded.
   *
   * These accumulate for the life of the install. Fine at a handful per shift; a future
   * change should prune anything older than the shift it belongs to, which is naturally
   * SCRUM-130's territory since that story already has to reason about queue lifetime.
   */
  dispatch: ActionDispatch;
}

export interface DispatchInboxState {
  status: InboxStatus;
  /** Server's PENDING list. */
  pending: ActionDispatch[];
  /** Locally known acknowledgements, keyed by dispatch id. Persisted. */
  acknowledged: Record<string, AcknowledgementRecord>;
  /** Persisted. Survives a kill mid-request — the whole point. */
  idempotencyKeys: Record<string, string>;
  /** Dispatch ids with an acknowledgement in flight. */
  inFlight: string[];
  /** Per-dispatch failure, so one failed card does not blank the whole list. */
  failures: Record<string, string>;
  errorKey: string | null;
  requestId: string | null;
  refreshing: boolean;
}

const initialState: DispatchInboxState = {
  status: "idle",
  pending: [],
  acknowledged: {},
  idempotencyKeys: {},
  inFlight: [],
  failures: {},
  errorKey: null,
  requestId: null,
  refreshing: false,
};

/**
 * A v4 UUID from `expo-crypto`, which uses a cryptographically secure source.
 *
 * `Math.random` would be adequate for collision avoidance at this volume, but an
 * idempotency key ends up in server logs and audit trails as a request identifier, and a
 * predictable one is a needless invitation. The fallback exists only so a platform without
 * the native module degrades rather than crashing on a safety screen.
 */
function newIdempotencyKey(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

export const loadInbox = createAsyncThunk<
  ActionDispatch[],
  { workerId: string; refreshing?: boolean },
  { rejectValue: { errorKey: string; requestId: string | null } }
>("inbox/load", async ({ workerId }, { rejectWithValue }) => {
  try {
    return await fetchPendingDispatches(workerId);
  } catch (error) {
    if (isApiError(error)) {
      const apiError = error as ApiError;
      return rejectWithValue({ errorKey: messageKeyFor(apiError), requestId: apiError.requestId });
    }
    return rejectWithValue({ errorKey: "errors.unknown", requestId: null });
  }
});

/**
 * One tap. Mints the key if there isn't one, then sends — and sends the *same* key on every
 * subsequent attempt.
 *
 * The key is written to the store before the request goes out, not after it succeeds. If
 * the order were reversed, a crash between "server committed" and "client recorded" would
 * lose the key and the retry would mint a new one — reintroducing exactly the double-write
 * this is meant to prevent.
 */
export const acknowledge = createAsyncThunk<
  { dispatchId: string; record: AcknowledgementRecord },
  { dispatchId: string },
  { state: RootState; rejectValue: { dispatchId: string; errorKey: string } }
>("inbox/acknowledge", async ({ dispatchId }, { getState, dispatch, rejectWithValue }) => {
  const existing = getState().dispatchInbox.idempotencyKeys[dispatchId];
  const idempotencyKey = existing ?? newIdempotencyKey();

  if (!existing) {
    dispatch(idempotencyKeyAssigned({ dispatchId, idempotencyKey }));
  }

  try {
    const result = await acknowledgeDispatch(dispatchId, idempotencyKey);
    return {
      dispatchId,
      record: {
        // Prefer the server's own timestamp; fall back to now only if it sent none.
        acknowledgedAt: result.startTime ?? new Date().toISOString(),
        idempotencyKey,
        dispatch: result,
      },
    };
  } catch (error) {
    const errorKey = isApiError(error) ? messageKeyFor(error as ApiError) : "errors.unknown";
    return rejectWithValue({ dispatchId, errorKey });
  }
}, {
  /*
   * One request in flight per action, and none at all once it is acknowledged.
   *
   * The button disables itself while `inFlight`, but that is a render away from the tap.
   * Two quick taps both land before React commits the disabled state, and without this
   * guard both fire a request. They would carry the same key and the server would dedupe
   * them, so the *result* stays correct — but it is two requests on a site connection to
   * achieve one write, and it opens the interleaving that the `rejected` case below has to
   * defend against. Cheaper to not start the second one.
   *
   * Returning false here dispatches nothing at all: no pending, no rejected, no state
   * change. That is the intended behaviour — a suppressed duplicate is not a failure and
   * must not render as one.
   */
  condition: ({ dispatchId }, { getState }) => {
    const inbox = (getState() as RootState).dispatchInbox;
    if (inbox.inFlight.includes(dispatchId)) return false;
    if (inbox.acknowledged[dispatchId]) return false;
    return true;
  },
});

const dispatchInboxSlice = createSlice({
  name: "dispatchInbox",
  initialState,
  reducers: {
    idempotencyKeyAssigned: (
      state,
      action: PayloadAction<{ dispatchId: string; idempotencyKey: string }>,
    ) => {
      state.idempotencyKeys[action.payload.dispatchId] = action.payload.idempotencyKey;
    },
    dismissFailure: (state, action: PayloadAction<string>) => {
      delete state.failures[action.payload];
    },
    /** Dev only, paired with the mock's reset so the flow can be replayed. */
    resetAcknowledgements: (state) => {
      state.acknowledged = {};
      state.idempotencyKeys = {};
      state.failures = {};
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadInbox.pending, (state, action) => {
        // A background poll that already has data must not blank the list — least of all
        // while an acknowledgement is in flight on one of the cards.
        if (action.meta.arg.refreshing) state.refreshing = true;
        else if (state.status !== "ready") state.status = "loading";
        state.errorKey = null;
      })
      .addCase(loadInbox.fulfilled, (state, action) => {
        state.status = "ready";
        state.refreshing = false;
        state.pending = action.payload;
        state.errorKey = null;
        state.requestId = null;
      })
      .addCase(loadInbox.rejected, (state, action) => {
        state.status = "error";
        state.refreshing = false;
        state.errorKey = action.payload?.errorKey ?? "errors.unknown";
        state.requestId = action.payload?.requestId ?? null;
      })

      .addCase(acknowledge.pending, (state, action) => {
        const id = action.meta.arg.dispatchId;
        if (!state.inFlight.includes(id)) state.inFlight.push(id);
        delete state.failures[id];
      })
      .addCase(acknowledge.fulfilled, (state, action) => {
        const { dispatchId, record } = action.payload;
        state.inFlight = state.inFlight.filter((id) => id !== dispatchId);
        state.acknowledged[dispatchId] = record;
        delete state.failures[dispatchId];
        // Drop it from the pending list immediately rather than waiting for a refetch: the
        // server would stop returning it anyway, and leaving it would render the same
        // action twice — once pending, once acknowledged.
        state.pending = state.pending.filter((item) => item.id !== dispatchId);
      })
      .addCase(acknowledge.rejected, (state, action) => {
        const id = action.payload?.dispatchId ?? action.meta.arg.dispatchId;
        state.inFlight = state.inFlight.filter((item) => item !== id);

        /*
         * Never contradict a success.
         *
         * If two attempts ever overlap — the `condition` guard makes that hard, not
         * impossible, since a queued replay could arrive alongside a manual retry — the
         * rejection can land *after* the fulfilment. Writing the failure unconditionally
         * would leave the card reading "Acknowledged at 14:32" and "Could not send your
         * acknowledgement" at the same time, which is worse than either alone: the worker
         * cannot tell whether their supervisor knows.
         *
         * A success already happened, so the failed attempt is stale news. Drop it.
         */
        if (state.acknowledged[id]) return;

        // Per-card, not global: a failure on one action must not hide the others, and the
        // card keeps its key so the retry is a replay rather than a new write.
        state.failures[id] = action.payload?.errorKey ?? "errors.unknown";
      })

      /*
       * Clear on sign-out, like the safety slice — but note what is being cleared. The
       * acknowledgement records belong to the user who made them; leaving them would show
       * the next worker someone else's completed actions.
       */
      .addMatcher(
        (action) =>
          action.type === "auth/signOut/fulfilled" ||
          action.type === "auth/sessionExpired/fulfilled",
        () => initialState,
      );
  },
});

export const { idempotencyKeyAssigned, dismissFailure, resetAcknowledgements } =
  dispatchInboxSlice.actions;

export default dispatchInboxSlice.reducer;
