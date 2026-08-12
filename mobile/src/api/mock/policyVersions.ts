/**
 * Heat policy versions for `mock` auth mode (SCRUM-120).
 *
 * Seeded with three versions rather than one, and that matters more here than usual. A freshly
 * migrated site has exactly one auto-activated version and no history, so a catalogue screen
 * reviewed against real data is only ever seen in its most trivial state — one row, nothing to
 * compare, no supersession, no draft awaiting activation. These fixtures put the screen in the
 * state it will actually be in six months from now.
 *
 * @author Justin Chua
 */
import { ApiError } from "../errors";
import type { PolicyVersionInput } from "../endpoints/policyVersions";
import type { PolicyVersion } from "@/types/domain";

const SITE = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "sm000001-0000-4000-8000-00000000000a";

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `pv00000${sequence}-0000-4000-8000-00000000000${sequence.toString(16)}`;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);

/** MOM's default ladder: light ≥ moderate ≥ heavy within each acclimatisation level. */
function thresholds(offset: number) {
  const at = (base: number) => (base + offset).toFixed(2);
  return {
    wbgtThresholdUnacclimatisedLight: at(25),
    wbgtThresholdUnacclimatisedModerate: at(23),
    wbgtThresholdUnacclimatisedHeavy: at(21),
    wbgtThresholdPartialLight: at(26),
    wbgtThresholdPartialModerate: at(24),
    wbgtThresholdPartialHeavy: at(22),
    wbgtThresholdFullLight: at(28),
    wbgtThresholdFullModerate: at(26),
    wbgtThresholdFullHeavy: at(24),
  };
}

function seed(): PolicyVersion[] {
  return [
    {
      id: nextId(),
      siteId: SITE,
      versionLabel: "MOM-WBGT-2026.2",
      source: "MOM Work-Rest Guidelines 2026, revision 2",
      effectiveDate: dateAgo(0),
      status: "DRAFT",
      ...thresholds(0),
      wbgtEmergencyStop: "33.00",
      // A draft awaiting activation: the state the activate flow exists for, and the one a
      // one-version fixture could never show.
      notes: "Tightens the unacclimatised heavy threshold ahead of the June revision.",
      createdBy: AUTHOR,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
      activatedAt: null,
      supersededAt: null,
    },
    {
      id: nextId(),
      siteId: SITE,
      versionLabel: "MOM-WBGT-2026.1",
      source: "MOM Work-Rest Guidelines 2026, revision 1",
      effectiveDate: dateAgo(45),
      status: "ACTIVE",
      ...thresholds(0),
      wbgtEmergencyStop: "33.00",
      notes: null,
      createdBy: AUTHOR,
      createdAt: daysAgo(46),
      updatedAt: daysAgo(45),
      activatedAt: daysAgo(45),
      supersededAt: null,
    },
    {
      id: nextId(),
      siteId: SITE,
      versionLabel: "MOM-WBGT-2025.3",
      source: "MOM Work-Rest Guidelines 2025, revision 3",
      effectiveDate: dateAgo(400),
      status: "SUPERSEDED",
      // Half a degree slacker throughout — so a supervisor comparing an old recommendation
      // against today's rules can see that the rules themselves moved.
      ...thresholds(0.5),
      wbgtEmergencyStop: "33.50",
      notes: null,
      createdBy: AUTHOR,
      createdAt: daysAgo(401),
      updatedAt: daysAgo(45),
      activatedAt: daysAgo(400),
      supersededAt: daysAgo(45),
    },
  ];
}

let store: PolicyVersion[] | null = null;

function all(): PolicyVersion[] {
  store ??= seed();
  return store;
}

/** Deep-copied out: Redux freezes what it receives, after which the mock cannot write to it. */
const copy = (version: PolicyVersion): PolicyVersion => ({ ...version });

/** Newest effective date first, matching the server's ordering. */
export function mockListPolicyVersions(): PolicyVersion[] {
  return [...all()]
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    .map(copy);
}

export function mockCreatePolicyVersion(input: PolicyVersionInput): PolicyVersion {
  // Mirrors the server's uniqueness rule. A duplicate label is a 409 there, and a mock that
  // accepted one would let the form ship without handling the case.
  if (all().some((version) => version.versionLabel === input.versionLabel)) {
    throw new ApiError("conflict", "A version with this label already exists", 409, null);
  }

  const now = new Date().toISOString();
  const created: PolicyVersion = {
    id: nextId(),
    siteId: SITE,
    versionLabel: input.versionLabel,
    source: input.source,
    effectiveDate: input.effectiveDate,
    // DRAFT unless this is the site's first version, which the server activates immediately —
    // a site whose rules nobody activated has no rules at all.
    status: all().length === 0 ? "ACTIVE" : "DRAFT",
    wbgtThresholdUnacclimatisedLight: input.wbgtThresholdUnacclimatisedLight,
    wbgtThresholdUnacclimatisedModerate: input.wbgtThresholdUnacclimatisedModerate,
    wbgtThresholdUnacclimatisedHeavy: input.wbgtThresholdUnacclimatisedHeavy,
    wbgtThresholdPartialLight: input.wbgtThresholdPartialLight,
    wbgtThresholdPartialModerate: input.wbgtThresholdPartialModerate,
    wbgtThresholdPartialHeavy: input.wbgtThresholdPartialHeavy,
    wbgtThresholdFullLight: input.wbgtThresholdFullLight,
    wbgtThresholdFullModerate: input.wbgtThresholdFullModerate,
    wbgtThresholdFullHeavy: input.wbgtThresholdFullHeavy,
    wbgtEmergencyStop: input.wbgtEmergencyStop,
    notes: input.notes?.trim() ? input.notes.trim() : null,
    createdBy: AUTHOR,
    createdAt: now,
    updatedAt: now,
    activatedAt: all().length === 0 ? now : null,
    supersededAt: null,
  };

  all().push(created);
  return copy(created);
}

/**
 * Activating retires whatever was active, in one step — the same atomicity the server gives it.
 * A half-applied switch would leave a site with two active versions or none, and either is worse
 * than the switch failing.
 */
export function mockActivatePolicyVersion(versionId: string): PolicyVersion {
  const target = all().find((version) => version.id === versionId);
  if (!target) {
    throw new ApiError("not-found", "No such policy version", 404, null);
  }
  if (target.status === "SUPERSEDED") {
    // Terminal by design: a version that governed a site once is never quietly brought back.
    throw new ApiError("conflict", "A superseded version cannot be reactivated", 409, null);
  }
  if (target.status === "ACTIVE") {
    throw new ApiError("conflict", "This version is already active", 409, null);
  }

  const now = new Date().toISOString();
  for (const version of all()) {
    if (version.status === "ACTIVE") {
      version.status = "SUPERSEDED";
      version.supersededAt = now;
      version.updatedAt = now;
    }
  }

  target.status = "ACTIVE";
  target.activatedAt = now;
  target.updatedAt = now;
  return copy(target);
}

/** Test seam — lets a test start clean rather than inheriting another test's writes. */
export function resetMockPolicyVersions(): void {
  store = null;
  sequence = 0;
}
