/**
 * Translating a dispatched instruction, without overwriting one a supervisor wrote.
 *
 * ── THE BUG ─────────────────────────────────────────────────────────────────────────────
 * A worker's Alerts card translated its title and not its instruction. The title comes from
 * `actionCode` and has always been translatable; the instruction is a server-authored English
 * sentence, so a Hindi-reading worker saw "छाया में जाएँ" above "Keep shaded recovery space
 * available to the crew".
 *
 * ── WHAT THIS FILE IS NOW ───────────────────────────────────────────────────────────────
 * The FALLBACK path, not the primary one. A dispatch now carries `instructionCode`, resolved
 * server-side by `InstructionCatalogue`, and `instructionKeyForDispatch` below prefers it.
 *
 * The text match remains because rows written before the backend's V25 migration have no code
 * and cannot be backfilled: a stored HYDRATE row does not record which of the two hydration
 * sentences it meant, and guessing would silently alter an instruction a worker has already
 * acknowledged. Matching their text recovers it exactly.
 *
 * It also remains as the answer to a question the code path cannot settle: the model writes
 * `action` freely (ml-service declares it as a 1..200 character string), so an instruction that
 * matches NOTHING here is either the model's own wording or a supervisor's edit — and either
 * way it must be shown as written.
 *
 * ── WHY MATCHING ON TEXT WAS NEEDED AT ALL ──────────────────────────────────────────────
 * The obvious fix is `t(`actionInstructions.${dispatch.actionCode}`)`. It does not work, for a
 * reason that is invisible until you read `ActionCatalogue.DISPATCH_CODE_BY_CODE`: the code on
 * a dispatch is the DISPATCH code, and several mitigation codes collapse onto one.
 *
 *     HYDRATE_HOURLY     → HYDRATE   "Drink water every hour, roughly one cup per break"
 *     HYDRATE_REGULARLY  → HYDRATE   "Drink water regularly throughout the shift"
 *     SHADE_RECOVERY     → SEEK_SHADE
 *
 * Two different instructions arrive under one code, so the code cannot choose between them.
 * The text can.
 *
 * ── AND WHY THAT IS THE RIGHT MECHANISM ANYWAY ──────────────────────────────────────────
 * A supervisor may EDIT a plan before approving it, and the dispatched instruction is
 * `mitigation.action()` — so that sentence may be a human's deliberate rewording. Translating
 * from the code would silently replace "Drink water at the north tap only" with the generic
 * sentence, discarding a safety instruction someone wrote on purpose.
 *
 * Matching the text solves both at once: an exact match is provably the canned sentence and is
 * safe to translate; anything else was written by a person or a model and is shown as written.
 *
 * ── KEEPING THIS IN STEP WITH THE SERVER ────────────────────────────────────────────────
 * The English below is copied from `DeterministicPlanBuilder.ACTION_TEXT` and the lightning
 * sentence in `DeterministicPlanBuilder.forLightning`. If the server rewords one, the match
 * fails and that instruction falls back to English — degraded, not broken, and visible the
 * first time anyone looks at the card in a non-English locale.
 *
 * @author Justin Chua
 */

/**
 * The server's canned instructions, keyed by the mitigation action code they belong to.
 *
 * Mirrors `DeterministicPlanBuilder.ACTION_TEXT` exactly, including punctuation — an exact
 * match is the whole mechanism, so a "tidied" comma here silently stops a translation working.
 */
const CANNED_INSTRUCTIONS: Readonly<Record<string, string>> = {
  STOP_WORK: "Stop work immediately and move the crew to a cool, shaded area",
  RESUME_WORK: "Work may resume under normal precautions",
  REST_10_MIN_HOURLY: "Take a 10-minute rest break in shade every hour",
  REST_15_MIN_HOURLY: "Take a 15-minute rest break in shade every hour",
  HYDRATE_HOURLY: "Drink water every hour, roughly one cup per break",
  HYDRATE_REGULARLY: "Drink water regularly throughout the shift",
  SHADE_RECOVERY: "Keep shaded recovery space available to the crew",
  RESCHEDULE_HEAVY_WORK: "Move heavy tasks to a cooler part of the day where possible",
  ROTATE_TO_LIGHT_DUTY: "Rotate affected workers onto lighter duties",
  CLOSE_MONITORING: "Monitor affected workers closely for signs of heat illness",
  /*
   * Not from ACTION_TEXT: `forLightning` builds this one inline, and it carries the STOP_WORK
   * code with different wording. Keyed separately, which is only possible because the match is
   * on text — under a code-keyed scheme these two would collide.
   */
  STOP_WORK_LIGHTNING:
    "Stop work and move the crew to a substantial building or a fully enclosed vehicle",
};

/** Reverse index, built once. Text is the key because text is what arrives on the dispatch. */
const CODE_BY_INSTRUCTION: ReadonlyMap<string, string> = new Map(
  Object.entries(CANNED_INSTRUCTIONS).map(([code, text]) => [normalise(text), code]),
);

/**
 * Trims and collapses internal whitespace before comparing.
 *
 * Deliberately no case folding and no punctuation stripping. Those would start treating a
 * genuine edit as canned — and the cost of that mistake is a worker reading generic advice
 * where a supervisor wrote something specific about their site. Whitespace is formatting
 * noise; everything else is wording.
 */
function normalise(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * The translation key for a dispatched instruction, or null if it was not the canned sentence.
 *
 * Null is the safe answer and the caller must render the server's text on it — see the header
 * for why replacing a supervisor's edit would be worse than leaving it in English.
 */
export function instructionKeyFor(instruction: string | null | undefined): string | null {
  if (!instruction?.trim()) return null;

  const code = CODE_BY_INSTRUCTION.get(normalise(instruction));
  return code ? `actionInstructions.${code}` : null;
}

/**
 * The translation key for a whole dispatch: its code first, its text second.
 *
 * ── WHY THE CODE WINS ───────────────────────────────────────────────────────────────────
 * Because the text is not trustworthy and the code is. `MitigationSuggestion.action` is a free
 * string on the ml-service side, so on the live Bedrock path the sentence is whatever the model
 * composed for that one request — "Take breaks in shade whenever possible to allow passive
 * cooling" appears nowhere in either repository. No table can match that, which is why the text
 * path translated the deterministic fallback and left live plans in English.
 *
 * The code is drawn from a ten-item allowlist that `agent/validation.py` rejects any deviation
 * from, and which the policy engine must already have mandated. So the model may re-word an
 * instruction but may not choose a different one: the code carries the safety content and the
 * prose carries only style.
 *
 * ── WHY AN UNRECOGNISED CODE IS NOT TRUSTED ─────────────────────────────────────────────
 * A code with no key falls through to the text rather than rendering `actionInstructions.FOO`.
 * A worker who reads an untranslated English instruction can still act on it; a worker looking
 * at a raw translation key cannot.
 */
export function instructionKeyForDispatch(
  instructionCode: string | null | undefined,
  instruction: string | null | undefined,
): string | null {
  if (instructionCode?.trim() && CANNED_INSTRUCTIONS[instructionCode]) {
    return `actionInstructions.${instructionCode}`;
  }
  return instructionKeyFor(instruction);
}

/** Exported for the test that keeps this table in step with the server's. */
export const CANNED_INSTRUCTION_CODES = Object.keys(CANNED_INSTRUCTIONS);
