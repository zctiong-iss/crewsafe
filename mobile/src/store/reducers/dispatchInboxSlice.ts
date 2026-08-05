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
import { restDeadlineFor } from "@/helpers/restDuration";
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
  /**
   * When this action stops being owed, as epoch ms — or null if it has no derivable end.
   *
   * Computed once, at acknowledgement, and persisted with the record. Two consequences that
   * are the whole point:
   *
   *   • A fifteen-minute rest survives the app being killed. Recomputing from "now" on
   *     relaunch would restart it, which punishes a worker for something they did not do —
   *     and on a site phone a process death mid-shift is not an edge case.
   *   • The deadline cannot drift. Deriving it during render would push the finish line
   *     forward on every tick.
   *
   * Wall-clock rather than elapsed-since-mount, because a monotonic timer cannot survive
   * process death. The accepted cost is that changing the device clock can end a rest early;
   * see `restDuration.ts` and the SCRUM-206 plan.
   */
  dismissAt: number | null;
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
  /**
   * Ids the worker no longer needs to see. Persisted.
   *
   * Hiding rather than deleting. The acknowledgement record itself has to survive: it is
   * what renders the acknowledged state until the card goes, what keeps a replayed
   * acknowledgement idempotent (SCRUM-186), and what SCRUM-130 will build its queue on.
   * Deleting it to clear the card would throw all of that away to achieve a visual change.
   *
   * Persisted for the same reason the deadline is: a card dismissed at 07:51 must not
   * reappear because the app was relaunched at 07:52 and the server still had opinions.
   */
  dismissedIds: string[];
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
  dismissedIds: [],
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
    // Prefer the server's own timestamp; fall back to now only if it sent none.
    const acknowledgedAt = result.startTime ?? new Date().toISOString();
    return {
      dispatchId,
      record: {
        acknowledgedAt,
        idempotencyKey,
        dispatch: result,
        // Resolved here, once, so it is persisted with the record rather than recomputed
        // per render. Null for any code with no derivable duration — see `restDuration.ts`.
        dismissAt: restDeadlineFor(result, acknowledgedAt),
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
    /**
     * Take a card off the list. Fired by the card itself when its deadline passes.
     *
     * Card-driven rather than list-driven on purpose. A clock at the list would re-render
     * every row once a second to discover that nothing had changed; a card already ticking
     * for its own countdown knows the moment it expires and can say so once. The list then
     * re-renders on a real event instead of on a schedule.
     *
     * Guarded against duplicates: a card can expire and be swiped in the same tick, and an
     * id appearing twice would make the filter below do the same work twice forever.
     */
    dismissed: (state, action: PayloadAction<string>) => {
      if (!state.dismissedIds.includes(action.payload)) {
        state.dismissedIds.push(action.payload);
      }
      // Drop it from `pending` too. The server returns PENDING rows only, so an
      // acknowledged action should already be gone from that list — but a refetch that
      // started before the acknowledgement landed can still carry it, and without this the
      // card would flicker back for one poll interval.
      state.pending = state.pending.filter((item) => item.id !== action.payload);
    },
    /** Dev only, paired with the mock's reset so the flow can be replayed. */
    resetAcknowledgements: (state) => {
      state.acknowledged = {};
      state.idempotencyKeys = {};
      state.failures = {};
      state.dismissedIds = [];
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

export const { idempotencyKeyAssigned, dismissFailure, dismissed, resetAcknowledgements } =
  dispatchInboxSlice.actions;

export default dispatchInboxSlice.reducer;
