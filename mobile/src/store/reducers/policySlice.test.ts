/**
 * What the policy slice guarantees (SCRUM-120).
 *
 * The load-bearing case is activation. It changes two rows server-side — the incoming version and
 * the one it retires — and the slice deliberately re-reads rather than patching, because a client
 * reconstructing that transaction is a client that can end up showing two active versions, or
 * none. These tests pin that it takes the server's answer wholesale.
 *
 * @author Justin Chua
 */
import reducer, {
  activatePolicyVersion,
  createPolicyVersion,
  loadPolicyVersions,
  selectActiveVersion,
} from "./policySlice";
import type { PolicyVersion, PolicyVersionStatus } from "@/types/domain";

function version(
  id: string,
  effectiveDate: string,
  status: PolicyVersionStatus = "DRAFT",
): PolicyVersion {
  return {
    id,
    siteId: "site-1",
    versionLabel: `label-${id}`,
    source: "MOM",
    effectiveDate,
    status,
    wbgtThresholdUnacclimatisedLight: "25.00",
    wbgtThresholdUnacclimatisedModerate: "23.00",
    wbgtThresholdUnacclimatisedHeavy: "21.00",
    wbgtThresholdPartialLight: "26.00",
    wbgtThresholdPartialModerate: "24.00",
    wbgtThresholdPartialHeavy: "22.00",
    wbgtThresholdFullLight: "28.00",
    wbgtThresholdFullModerate: "26.00",
    wbgtThresholdFullHeavy: "24.00",
    wbgtEmergencyStop: "33.00",
    notes: null,
    createdBy: "u1",
    createdAt: `${effectiveDate}T00:00:00Z`,
    updatedAt: `${effectiveDate}T00:00:00Z`,
    activatedAt: status === "ACTIVE" ? `${effectiveDate}T00:00:00Z` : null,
    supersededAt: status === "SUPERSEDED" ? `${effectiveDate}T00:00:00Z` : null,
  };
}

const initial = () => reducer(undefined, { type: "@@INIT" });

describe("loading", () => {
  it("orders by effective date, newest first", () => {
    const next = reducer(initial(), {
      type: loadPolicyVersions.fulfilled.type,
      payload: [
        version("old", "2025-01-01", "SUPERSEDED"),
        version("new", "2026-08-01", "DRAFT"),
        version("mid", "2026-01-01", "ACTIVE"),
      ],
    });

    expect(next.versions.map((v) => v.id)).toEqual(["new", "mid", "old"]);
    expect(next.status).toBe("ready");
  });

  it("finds the version in force regardless of where it sorts", () => {
    const loaded = reducer(initial(), {
      type: loadPolicyVersions.fulfilled.type,
      // The active one is not the newest: a draft dated later is waiting to be activated, which
      // is exactly the state the activate flow exists for.
      payload: [version("draft", "2026-08-01", "DRAFT"), version("live", "2026-01-01", "ACTIVE")],
    });

    expect(selectActiveVersion({ policy: loaded })?.id).toBe("live");
  });

  it("reports an error rather than showing an empty catalogue", () => {
    const next = reducer(initial(), {
      type: loadPolicyVersions.rejected.type,
      payload: { errorKey: "errors.forbidden" },
    });

    // An empty list and an unreadable one look identical, and one of them means "this site has
    // no rules" — which would be a dangerous thing to imply.
    expect(next.status).toBe("error");
    expect(next.errorKey).toBe("errors.forbidden");
  });
});

describe("creating", () => {
  it("inserts the new version in date order without a reload", () => {
    const loaded = reducer(initial(), {
      type: loadPolicyVersions.fulfilled.type,
      payload: [version("live", "2026-01-01", "ACTIVE")],
    });

    const next = reducer(loaded, {
      type: createPolicyVersion.fulfilled.type,
      payload: version("fresh", "2026-09-01", "DRAFT"),
    });

    expect(next.versions.map((v) => v.id)).toEqual(["fresh", "live"]);
    expect(next.creating).toBe(false);
  });

  it("releases the button when the server refuses", () => {
    const busy = reducer(initial(), { type: createPolicyVersion.pending.type });
    expect(busy.creating).toBe(true);

    // A duplicate label is a 409. Reported on the form, where the field is; the slice only stops
    // the spinner, or the safety manager is stranded on a screen that never settles.
    const next = reducer(busy, {
      type: createPolicyVersion.rejected.type,
      payload: { errorKey: "errors.conflict" },
    });
    expect(next.creating).toBe(false);
  });
});

describe("activating", () => {
  it("takes the server's whole list rather than patching two rows", () => {
    const loaded = reducer(initial(), {
      type: loadPolicyVersions.fulfilled.type,
      payload: [version("draft", "2026-08-01", "DRAFT"), version("live", "2026-01-01", "ACTIVE")],
    });

    const next = reducer(loaded, {
      type: activatePolicyVersion.fulfilled.type,
      // What the server actually reports after the switch: one promoted, one retired.
      payload: [
        version("draft", "2026-08-01", "ACTIVE"),
        version("live", "2026-01-01", "SUPERSEDED"),
      ],
    });

    expect(selectActiveVersion({ policy: next })?.id).toBe("draft");
    expect(next.versions.filter((v) => v.status === "ACTIVE")).toHaveLength(1);
    expect(next.activatingId).toBeNull();
  });

  it("marks only the version being activated as busy", () => {
    const busy = reducer(initial(), {
      type: activatePolicyVersion.pending.type,
      meta: { arg: { versionId: "draft" } },
    });
    expect(busy.activatingId).toBe("draft");

    const next = reducer(busy, {
      type: activatePolicyVersion.rejected.type,
      payload: { errorKey: "errors.conflict" },
    });
    expect(next.activatingId).toBeNull();
  });
});
