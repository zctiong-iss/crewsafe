-- SCRUM-432: give every site the MOM national baseline, so the heat-safety engine is not inert
-- out of the box.
--
-- WHY THIS IS NEEDED
--
-- V9 shipped a seed of these exact thresholds but left it commented out, justified by the note
-- "(Sites without a policy will use application defaults)". That was true at V9. SCRUM-120 then
-- replaced heat_rest_policy with versioned policy_version and made PolicyEngineService THROW
-- rather than fall back, which removed the backstop the comment depended on -- and the comment,
-- and the commented-out seed, were never revisited. V12 compounded it by carrying forward
-- SELECT ... FROM heat_rest_policy, a table that was empty precisely because V9's seed was off.
-- So policy_version was born empty and stayed empty on every database ever created.
--
-- The consequence was not a cosmetic gap: with no ACTIVE version, PolicyEngineService throws,
-- AgentDraftService returns 409, and the site produces no recommendations, no mandatory rest and
-- no hydration controls whatsoever.
--
-- WHY SEEDING DOES NOT WEAKEN §7.1
--
-- §7.1 wants thresholds to be configuration records rather than constants compiled into the
-- engine. This inserts exactly that: a labelled, sourced, dated, supersedable policy_version row.
-- The engine reads whichever version is ACTIVE and cites its label on every decision; it has no
-- idea one was seeded. A site that runs stricter numbers than MOM supersedes this through the
-- normal Safety Manager API. created_by is NULL because no person configured it -- the same
-- convention V12 used for the versions it carried forward.
--
-- These values are duplicated in MomHeatPolicyDefaults.java, because Java cannot be called from a
-- migration. MomHeatPolicyDefaultsTest asserts the two agree so they cannot drift apart silently.

INSERT INTO policy_version (
    id, site_id, version_label, source, effective_date, status,
    wbgt_threshold_unacclimatised_light,
    wbgt_threshold_unacclimatised_moderate,
    wbgt_threshold_unacclimatised_heavy,
    wbgt_threshold_partial_light,
    wbgt_threshold_partial_moderate,
    wbgt_threshold_partial_heavy,
    wbgt_threshold_full_light,
    wbgt_threshold_full_moderate,
    wbgt_threshold_full_heavy,
    wbgt_emergency_stop,
    notes, created_by, created_at, updated_at, activated_at
)
SELECT
    gen_random_uuid(),
    s.id,
    'MOM-WBGT-2026.1',
    'MOM Work-Rest Guidelines',
    CURRENT_DATE,
    'ACTIVE',
    25.0, 23.0, 21.0,  -- unacclimatised: light, moderate, heavy
    26.0, 24.0, 22.0,  -- partially acclimatised
    28.0, 26.0, 24.0,  -- fully acclimatised
    33.0,              -- emergency stop (MOM Band 3)
    'Seeded automatically as the national baseline (SCRUM-432). Supersede this with a '
        || 'site-specific version if this site operates to stricter thresholds.',
    NULL,              -- created_by: the system provided this, not a person
    now(), now(), now()
FROM site s
-- Idempotent, and never overwrites a configured policy. A site that already has an ACTIVE
-- version keeps it: uq_policy_version_active_per_site (V12) would reject a second ACTIVE row
-- anyway, but skipping here means re-running is a no-op rather than a constraint violation.
WHERE NOT EXISTS (
    SELECT 1 FROM policy_version pv
    WHERE pv.site_id = s.id
      AND pv.status = 'ACTIVE'
);
