/**
 * The plan's rationale, rebuilt from structured evidence so it can be translated.
 *
 * ── THE BUG THIS EXISTS TO FIX ──────────────────────────────────────────────────────────
 * The server sends `rationale` as finished English prose, assembled by string concatenation
 * in `DeterministicPlanBuilder.rationaleFromPolicy`:
 *
 *     "WBGT is 25.3°C, below 31°C, assessed against heat policy MOM-WBGT-2026.1.
 *      3 controls are required, with 4 further suggested. …"
 *
 * i18next can do nothing with that. It arrives as one opaque string, and the plan detail
 * screen rendered it verbatim — so a supervisor who had switched the app to Tamil was asked
 * to approve a plan whose explanation was still in English.
 *
 * ── WHY IT IS FIXABLE ON THE CLIENT AT ALL ──────────────────────────────────────────────
 * That sentence is a TEMPLATE, and every value in it already arrives as structured data:
 * `evidence.observedWbgt`, `evidence.currentBand`, `policyVersion`, and the mandatory and
 * advisory counts derivable from `mitigations[].origin`. Mobile simply never declared
 * `evidence`, so it discarded the inputs and rendered the output.
 *
 * This is the same fix the app already applies one level down. Mitigation text renders in
 * seven languages because it is built from `actionCode` rather than from the server's English
 * `action` string — `domain.ts` warns explicitly never to parse `action`. The rationale was
 * the same trap, one field over.
 *
 * ── WHY THIS RETURNS VALUES AND NOT A STRING ────────────────────────────────────────────
 * The caller passes these to `t()` for a single whole-sentence key. Building the sentence
 * here from translated fragments — "WBGT is X" + band + "assessed against Y" — would produce
 * grammatical nonsense in every language whose word order differs from English, which is most
 * of the seven. The sentence has to be one translatable unit; this only supplies its holes.
 *
 * @author Justin Chua
 */
import type { Mitigation, Recommendation, RecommendationEvidence } from "@/types/domain";
import { DETERMINISTIC_FALLBACK_MODEL } from "@/types/domain";

/**
 * Which sentence to render, and what to put in it.
 *
 * `key` is chosen rather than assembled so the caller cannot accidentally interpolate values
 * into a sentence that does not have holes for them.
 */
export interface RationaleSummary {
  /** i18n key for the whole sentence. */
  key: string;
  /** Interpolation values. `count` drives i18next's plural selection. */
  values: {
    wbgt?: string;
    band?: string;
    policyVersion?: string;
    count: number;
    advisory: number;
  };
  /**
   * True when the plan came from the policy engine rather than a language model.
   *
   * Drives a second, separate sentence rather than being folded into the first: it is a
   * statement about how the plan was PRODUCED, not about the conditions, and jamming both
   * into one string would give translators a sentence with two unrelated halves.
   */
  fromPolicyEngine: boolean;
}

/** Counts the two origins the server distinguishes. Anything unlabelled is not counted. */
function countByOrigin(mitigations: readonly Mitigation[]): { mandatory: number; advisory: number } {
  let mandatory = 0;
  let advisory = 0;
  for (const mitigation of mitigations) {
    if (mitigation.origin === "MANDATORY") mandatory += 1;
    else if (mitigation.origin === "ADVISORY") advisory += 1;
  }
  return { mandatory, advisory };
}

/**
 * Formats the reading exactly as the rest of the app formats it.
 *
 * ── WHY NOT `toLocaleString` ────────────────────────────────────────────────────────────
 * Locale formatting is the obvious choice and it is wrong here. `toLocaleString("bn")`
 * renders 25.3 as ২৫.৩ in Bengali numerals — correct in isolation, and it made the SAME
 * reading appear as "25.3" on the weather card (`WbgtCard` uses `toFixed(1)`) and "২৫.৩" in
 * this paragraph. A supervisor cross-checking the rationale against the reading it describes
 * would have been comparing two different-looking numbers.
 *
 * A WBGT value is also cross-checked against the MOM poster on the site wall, which prints
 * Latin digits. Rendering it identically everywhere beats rendering it idiomatically in one
 * place, so this matches the existing `toFixed(1)` precedent rather than introducing a second
 * convention for the same number.
 */
function formatWbgt(value: number): string {
  return value.toFixed(1);
}

/**
 * Picks the sentence and fills it.
 *
 * ── DEGRADING RATHER THAN RENDERING A HOLE ──────────────────────────────────────────────
 * Three shapes, chosen by what is actually known. A plan drafted for a site with no reading
 * has no WBGT and no band, and the sentence must not contain the words "undefined°C" — the
 * failure §7.1 calls degrade-not-fail, applied to copy.
 *
 *   evidence with a reading   → the full sentence
 *   evidence without one      → the policy-only sentence
 *   no evidence at all        → the counts alone, which is still worth saying
 */
export function buildRationaleSummary(
  recommendation: Pick<Recommendation, "mitigations" | "modelVersion" | "policyVersion"> & {
    evidence?: RecommendationEvidence | null;
  },
): RationaleSummary {
  const { mandatory, advisory } = countByOrigin(recommendation.mitigations);
  const evidence = recommendation.evidence ?? null;

  const fromPolicyEngine = recommendation.modelVersion === DETERMINISTIC_FALLBACK_MODEL;

  const hasReading = evidence?.observedWbgt !== null && evidence?.observedWbgt !== undefined;
  const hasPolicy = Boolean(recommendation.policyVersion);

  /*
   * The band is NOT translated here — the key is returned and the caller resolves it against
   * the existing `wbgt.band.*` strings. Those were translated once and reviewed; a second set
   * meaning the same thing would drift, and the band in this paragraph would eventually
   * disagree with the band on the weather card.
   */
  const band = evidence?.currentBand ? `wbgt.band.${evidence.currentBand}` : undefined;

  if (hasReading && hasPolicy) {
    return {
      key: "recommendations.rationaleReading",
      values: {
        wbgt: formatWbgt(evidence!.observedWbgt as number),
        band,
        policyVersion: recommendation.policyVersion as string,
        count: mandatory,
        advisory,
      },
      fromPolicyEngine,
    };
  }

  if (hasPolicy) {
    return {
      key: "recommendations.rationaleNoReading",
      values: {
        policyVersion: recommendation.policyVersion as string,
        count: mandatory,
        advisory,
      },
      fromPolicyEngine,
    };
  }

  return {
    key: "recommendations.rationaleCountsOnly",
    values: { count: mandatory, advisory },
    fromPolicyEngine,
  };
}

/**
 * Whether the server's own prose is worth showing beneath the summary.
 *
 * False for a deterministic-fallback plan, and that is the whole point: in that case the
 * server's string is the SAME template the summary just rendered, so showing both prints one
 * sentence twice — once translated and once not, which looks exactly like the bug this module
 * exists to fix.
 *
 * True only for genuine model prose, which cannot be reconstructed from structured data and
 * is the model's actual reasoning — the thing that makes an AI-drafted plan explainable.
 */
export function showsModelProse(
  recommendation: Pick<Recommendation, "modelVersion" | "rationale">,
): boolean {
  if (!recommendation.rationale?.trim()) return false;
  return recommendation.modelVersion !== DETERMINISTIC_FALLBACK_MODEL;
}
