/**
 * How long a dispatched rest lasts, and when it ends.
 *
 * ── THE DURATION NEVER COMES FROM THE RENDERED TITLE ────────────────────────────────────
 * The obvious-looking source is the text on the card — "Rest for 15 minutes" — and it is the
 * wrong one. That string is translated. The same card reads:
 *
 *   ta   15 நிமிடம் ஓய்வெடுங்கள்
 *   my   ၁၅ မိနစ် အနားယူပါ        ← Burmese numerals, not ASCII digits
 *   bn   ১৫ মিনিট বিশ্রাম নিন      ← Bengali numerals
 *
 * A regex over the title works in English and fails in six of the seven shipped languages,
 * and breaks again the first time a translator rewords a sentence. The duration is carried
 * structurally by `ActionDispatch`, so it is read from there.
 *
 * ── RESOLUTION ORDER ────────────────────────────────────────────────────────────────────
 *   1. `endTime` from the server. It is the server's own answer and outranks anything the
 *      client can derive. Nothing today sends it; the contract has the field, so honouring
 *      it now means the backend can start populating it without a client change.
 *   2. `REST_<n>_MIN` parsed from `actionCode`, measured from the acknowledgement.
 *   3. Nothing. The card renders exactly as it does today.
 *
 * Case 3 is a requirement rather than a fallback. `V3__domain_schema.sql` describes the
 * action catalogue as "a growing catalog of dispatchable actions", deliberately not an enum,
 * so the backend can add a code before this app understands it. An unrecognised code must
 * degrade to a normal card, never to a bar that counts down to a guess.
 */
import type { ActionDispatch } from "@/types/domain";

/**
 * Anchored, and the anchoring is load-bearing.
 *
 * `REST_10_MIN_HOURLY` is a *policy* action — "rest 10 minutes every hour" — that appears in
 * the heat plan, not a dispatched one-off rest. An unanchored pattern would match it and
 * start a ten-minute countdown against a rule that has no single deadline. `$` keeps the two
 * apart.
 */
const REST_CODE = /^REST_(\d+)_MIN$/;

/** Minutes from an action code, or null if it is not a fixed-length rest. */
export function restMinutesFor(actionCode: string): number | null {
  const match = REST_CODE.exec(actionCode);
  if (!match) return null;

  const minutes = Number(match[1]);
  // A zero or absurd value is a malformed code, not a rest. Better no bar than a bar that
  // completes instantly or never.
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 240) return null;
  return minutes;
}

/**
 * When an acknowledged action stops being owed, as epoch ms — or null if it has no
 * derivable end.
 *
 * `acknowledgedAt` is the client's record of when the server confirmed. Using it rather than
 * "now" is what makes the deadline stable: recomputing from the current time on every render
 * would push the finish line forward forever.
 */
export function restDeadlineFor(
  dispatch: ActionDispatch,
  acknowledgedAt: string,
): number | null {
  if (dispatch.endTime) {
    const fromServer = Date.parse(dispatch.endTime);
    if (!Number.isNaN(fromServer)) return fromServer;
    // A malformed server timestamp falls through to the code rather than failing the card.
  }

  const minutes = restMinutesFor(dispatch.actionCode);
  if (minutes === null) return null;

  const start = Date.parse(acknowledgedAt);
  if (Number.isNaN(start)) return null;

  return start + minutes * 60_000;
}

/** `m:ss`, for a countdown that has to stay readable at arm's length. */
export function formatRemaining(millis: number): string {
  const total = Math.max(0, Math.ceil(millis / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
