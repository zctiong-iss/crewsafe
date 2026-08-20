/**
 * The rationale rebuilt from evidence, and the shapes it has to degrade through.
 *
 * The bug this guards is not a crash — it is a supervisor being asked to approve a plan whose
 * explanation is in a language they do not read. So the cases below are about which sentence
 * gets chosen and what goes in it, including when the evidence is thin enough that the honest
 * answer is a shorter sentence rather than one with a hole in it.
 *
 * @author Justin Chua
 */
import {
  buildRationaleSummary,
  humaniseWorkerReferences,
  showsModelProse,
} from "./planRationale";
import { DETERMINISTIC_FALLBACK_MODEL } from "@/types/domain";
import type { Mitigation, MitigationOrigin, RecommendationEvidence } from "@/types/domain";

function mitigation(origin: MitigationOrigin | null): Mitigation {
  return {
    priority: null,
    action: "Rest 15 minutes in shade every hour",
    rationale: null,
    estimatedImpact: null,
    actionCode: "REST_15_MIN_HOURLY",
    category: "REST",
    origin,
    ruleReference: null,
    appliesTo: null,
    timing: null,
  };
}

function evidence(overrides: Partial<RecommendationEvidence> = {}): RecommendationEvidence {
  return {
    observedWbgt: 25.3,
    forecastWbgt30m: 25.4,
    currentBand: "BELOW_31",
    forecastBand: "BELOW_31",
    stationId: "S128",
    lightningState: "CLEAR",
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    mitigations: [mitigation("MANDATORY"), mitigation("ADVISORY")],
    modelVersion: "anthropic.claude-3-5-sonnet",
    policyVersion: "MOM-WBGT-2026.1",
    evidence: evidence(),
    ...overrides,
  } as Parameters<typeof buildRationaleSummary>[0];
}

describe("choosing the sentence", () => {
  it("uses the full sentence when there is a reading and a policy", () => {
    const summary = buildRationaleSummary(plan());

    expect(summary.key).toBe("recommendations.rationaleReading");
    expect(summary.values.wbgt).toBe("25.3");
    expect(summary.values.band).toBe("wbgt.band.BELOW_31");
    expect(summary.values.policyVersion).toBe("MOM-WBGT-2026.1");
  });

  it("drops to the policy-only sentence when the site has no reading", () => {
    /*
     * A real state, not a defensive one: a site whose ingestion has not run yet drafts a plan
     * with no observation. The sentence must not contain "undefined°C" — that is §7.1's
     * degrade-not-fail rule applied to copy.
     */
    const summary = buildRationaleSummary(
      plan({ evidence: evidence({ observedWbgt: null, currentBand: null }) }),
    );

    expect(summary.key).toBe("recommendations.rationaleNoReading");
    expect(summary.values.wbgt).toBeUndefined();
    expect(summary.values.band).toBeUndefined();
  });

  it("falls back to counts alone when there is no evidence at all", () => {
    // Recommendations drafted before SCRUM-118 carry no evidence. The counts are still worth
    // saying, and they are the part a supervisor acts on.
    const summary = buildRationaleSummary(plan({ evidence: null, policyVersion: null }));

    expect(summary.key).toBe("recommendations.rationaleCountsOnly");
    expect(summary.values.count).toBe(1);
  });

  it("treats a missing evidence field as absent rather than throwing", () => {
    const summary = buildRationaleSummary(plan({ evidence: undefined }));

    expect(summary.key).toBe("recommendations.rationaleNoReading");
  });
});

describe("the counts", () => {
  it("separates mandatory from advisory", () => {
    const summary = buildRationaleSummary(
      plan({
        mitigations: [
          mitigation("MANDATORY"),
          mitigation("MANDATORY"),
          mitigation("MANDATORY"),
          mitigation("ADVISORY"),
          mitigation("ADVISORY"),
        ],
      }),
    );

    expect(summary.values.count).toBe(3);
    expect(summary.values.advisory).toBe(2);
  });

  it("does not count a mitigation the server did not label", () => {
    // `origin` is nullable because plans drafted before PR #205 omit it. Counting an
    // unlabelled mitigation as mandatory would overstate what a crew is obliged to do.
    const summary = buildRationaleSummary(plan({ mitigations: [mitigation(null)] }));

    expect(summary.values.count).toBe(0);
    expect(summary.values.advisory).toBe(0);
  });

  it("carries the mandatory count as `count`, so i18next can pluralise on it", () => {
    // The sentence has two numbers and i18next allows exactly one `count` per key. The
    // mandatory count wins it: that is the one a supervisor is obliged to act on.
    const singular = buildRationaleSummary(plan({ mitigations: [mitigation("MANDATORY")] }));
    const plural = buildRationaleSummary(
      plan({ mitigations: [mitigation("MANDATORY"), mitigation("MANDATORY")] }),
    );

    expect(singular.values.count).toBe(1);
    expect(plural.values.count).toBe(2);
  });
});

describe("the reading", () => {
  it("formats to one decimal place", () => {
    const summary = buildRationaleSummary(
      plan({ evidence: evidence({ observedWbgt: 33 }) }),
    );

    expect(summary.values.wbgt).toBe("33.0");
  });

  it("renders the reading exactly as the weather card does, in every locale", () => {
    /*
     * Deliberately NOT locale-formatted, and this test is the record of why.
     *
     * The first version used `toLocaleString`, which is the obvious choice and was wrong:
     * `toLocaleString("bn")` renders 25.3 in Bengali numerals, so the SAME reading appeared as
     * "25.3" on the weather card and "২৫.৩" in this paragraph. A supervisor cross-checking one
     * against the other was comparing two different-looking numbers for one measurement.
     *
     * The value takes no locale precisely so it cannot drift from `WbgtCard`.
     */
    const summary = buildRationaleSummary(plan({ evidence: evidence({ observedWbgt: 25.3 }) }));

    expect(summary.values.wbgt).toBe("25.3");
  });

  it("returns the band as a translation key, not a translated string", () => {
    /*
     * Resolved by the caller against the EXISTING `wbgt.band.*` keys. A second set of band
     * strings would drift, and the band in this paragraph would eventually disagree with the
     * band on the weather card.
     */
    const summary = buildRationaleSummary(
      plan({ evidence: evidence({ currentBand: "33_AND_ABOVE" }) }),
    );

    expect(summary.values.band).toBe("wbgt.band.33_AND_ABOVE");
  });
});

describe("where the plan came from", () => {
  it("flags a plan built by the policy engine", () => {
    const summary = buildRationaleSummary(
      plan({ modelVersion: DETERMINISTIC_FALLBACK_MODEL }),
    );

    expect(summary.fromPolicyEngine).toBe(true);
  });

  it("does not flag a model-drafted plan", () => {
    expect(buildRationaleSummary(plan()).fromPolicyEngine).toBe(false);
  });
});

describe("whether the server's own prose is worth showing", () => {
  it("shows genuine model prose", () => {
    // It cannot be reconstructed from structured data, and it is the model's actual
    // reasoning — the thing that makes an AI-drafted plan explainable.
    expect(
      showsModelProse({
        modelVersion: "anthropic.claude-3-5-sonnet",
        rationale: "Forecast WBGT crosses into the 33 °C band within 30 minutes.",
      }),
    ).toBe(true);
  });

  it("SUPPRESSES the deterministic template", () => {
    /*
     * The case this function exists for. That string is the same sentence the summary just
     * rendered, so showing both prints one sentence twice — once translated and once not,
     * which looks exactly like the bug this change fixes.
     */
    expect(
      showsModelProse({
        modelVersion: DETERMINISTIC_FALLBACK_MODEL,
        rationale: "WBGT is 25.3°C, below 31°C, assessed against heat policy MOM-WBGT-2026.1.",
      }),
    ).toBe(false);
  });

  it("shows nothing when there is no prose", () => {
    expect(showsModelProse({ modelVersion: "anthropic.claude-3-5-sonnet", rationale: null })).toBe(
      false,
    );
  });

  it("treats whitespace-only prose as nothing", () => {
    expect(showsModelProse({ modelVersion: "anthropic.claude-3-5-sonnet", rationale: "   " })).toBe(
      false,
    );
  });
});

describe("worker references in model prose", () => {
  it("replaces only known worker UUIDs with their display names", () => {
    const knownWorkerId = "8f4f8762-4d8e-4624-8be6-0fb66ffa7b54";
    const unrelatedId = "f57b15b1-ff9f-4e2c-b72b-5fd88c3379ca";

    expect(
      humaniseWorkerReferences(
        `Worker ${knownWorkerId} needs lighter duties; retain reference ${unrelatedId}.`,
        [{ id: knownWorkerId, displayName: "Aisha Rahman" }],
      ),
    ).toBe(`Worker Aisha Rahman needs lighter duties; retain reference ${unrelatedId}.`);
  });

  it("leaves prose unchanged when the recommendation has no worker snapshot", () => {
    const rationale = "Worker 8f4f8762-4d8e-4624-8be6-0fb66ffa7b54 needs lighter duties.";

    expect(humaniseWorkerReferences(rationale, null)).toBe(rationale);
  });
});
