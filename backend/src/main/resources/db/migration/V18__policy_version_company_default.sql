-- V18: Company-wide default heat policy
-- @author Jemilin Beulah
--
-- Purpose: a site with zero ACTIVE policy_version rows of its own cannot produce a single
-- shift recommendation -- PolicyEngineService has nothing to evaluate against and throws.
-- This adds one company-wide default: a single policy_version row with site_id NULL, seeded
-- with MOM's published thresholds (the same numbers already hardcoded as this table's column
-- defaults below). PolicyEngineService falls back to it only when a site has no ACTIVE
-- version of its own -- a site's own version always takes precedence once it has one.
--
-- Deliberately not editable: this row is written once, by this migration, and never again
-- through the application -- no create/activate endpoint targets it. MOM's WBGT thresholds
-- are a regulatory floor, not a business preference; a site that needs something different
-- configures its own policy via the existing per-site create/activate flow (SCRUM-120), the
-- same way it always has -- it does not edit this row.

ALTER TABLE policy_version ALTER COLUMN site_id DROP NOT NULL;

-- Postgres treats every NULL as distinct in a unique index, so uq_policy_version_active_per_site
-- (site_id) does not stop a second ACTIVE default row from ever existing. Nothing in the
-- application writes to this row after this migration, but the constraint costs nothing and
-- matches the guarantee uq_policy_version_active_per_site already gives every site.
CREATE UNIQUE INDEX uq_policy_version_active_default
    ON policy_version((true)) WHERE status = 'ACTIVE' AND site_id IS NULL;

INSERT INTO policy_version (
    id, site_id, version_label, source, effective_date, status,
    wbgt_threshold_unacclimatised_light, wbgt_threshold_unacclimatised_moderate, wbgt_threshold_unacclimatised_heavy,
    wbgt_threshold_partial_light, wbgt_threshold_partial_moderate, wbgt_threshold_partial_heavy,
    wbgt_threshold_full_light, wbgt_threshold_full_moderate, wbgt_threshold_full_heavy,
    wbgt_emergency_stop, notes, created_by, created_at, updated_at, activated_at
) VALUES (
    gen_random_uuid(), NULL, 'MOM-WBGT-2026-DEFAULT', 'MOM Work-Rest Guidelines 2026 (company-wide default)',
    CURRENT_DATE, 'ACTIVE',
    25.0, 23.0, 21.0,
    26.0, 24.0, 22.0,
    28.0, 26.0, 24.0,
    33.0, 'Company-wide fallback for a site with no policy of its own. Not editable through the application.',
    NULL, NOW(), NOW(), NOW()
);

COMMENT ON COLUMN policy_version.site_id IS
'The site this version belongs to, or NULL for the one company-wide default (V18) that
PolicyEngineService falls back to when a site has no ACTIVE version of its own.';
