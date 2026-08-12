-- V12: Versioned heat policy catalogue (SCRUM-120)
-- @author Jemilin Beulah
--
-- Purpose: heat_rest_policy (V9) held exactly one mutable row per site, so a threshold
-- change silently overwrote whatever was there before -- nothing recorded where a rule
-- came from, when it took effect, or what was in force at some earlier point in time.
-- policy_version replaces it: every configuration a Safety Manager creates is kept, and
-- exactly one per site is ever ACTIVE at once. PolicyEngineService cites a version's own
-- version_label on every decision, in place of the hardcoded string it used before.

CREATE TABLE policy_version (
    id              UUID          PRIMARY KEY,
    site_id         UUID          NOT NULL REFERENCES site(id) ON DELETE CASCADE,

    -- Human-assigned, traceable identifier, e.g. 'MOM-WBGT-2026.2'. Unique per site so a
    -- Safety Manager cannot silently create two versions that claim the same label.
    version_label   VARCHAR(64)   NOT NULL,

    -- Where this version's thresholds came from, e.g. 'MOM Work-Rest Guidelines 2026 Rev B'
    -- or 'Site risk assessment, Jul 2026'. Free text: the source of a safety rule is not a
    -- fixed vocabulary the schema should constrain.
    source          VARCHAR(255)  NOT NULL,

    -- The date this version's rule is/was in force, as distinct from when the row was
    -- created or activated -- a Safety Manager may configure a version ahead of the date
    -- it starts applying, or backfill one for a rule that was already in effect.
    effective_date  DATE          NOT NULL,

    -- DRAFT: configured but not governing recommendations yet.
    -- ACTIVE: the version currently in force for this site (at most one per site).
    -- SUPERSEDED: was ACTIVE, replaced by a later activation. Never reused.
    status          VARCHAR(16)   NOT NULL DEFAULT 'DRAFT',

    -- Unacclimatised worker thresholds (degrees Celsius)
    wbgt_threshold_unacclimatised_light DECIMAL(5, 2) NOT NULL DEFAULT 25.0,
    wbgt_threshold_unacclimatised_moderate DECIMAL(5, 2) NOT NULL DEFAULT 23.0,
    wbgt_threshold_unacclimatised_heavy DECIMAL(5, 2) NOT NULL DEFAULT 21.0,

    -- Partially acclimatised worker thresholds (4-6 days)
    wbgt_threshold_partial_light DECIMAL(5, 2) NOT NULL DEFAULT 26.0,
    wbgt_threshold_partial_moderate DECIMAL(5, 2) NOT NULL DEFAULT 24.0,
    wbgt_threshold_partial_heavy DECIMAL(5, 2) NOT NULL DEFAULT 22.0,

    -- Fully acclimatised worker thresholds (7+ days)
    wbgt_threshold_full_light DECIMAL(5, 2) NOT NULL DEFAULT 28.0,
    wbgt_threshold_full_moderate DECIMAL(5, 2) NOT NULL DEFAULT 26.0,
    wbgt_threshold_full_heavy DECIMAL(5, 2) NOT NULL DEFAULT 24.0,

    -- Emergency stop threshold (all workers regardless of acclimatisation)
    -- MOM Band 3: WBGT >= 33°C requires stop work per MOM guidelines
    wbgt_emergency_stop DECIMAL(5, 2) NOT NULL DEFAULT 33.0,

    notes           TEXT,

    created_by      UUID          REFERENCES app_user(id),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    activated_at    TIMESTAMPTZ,
    superseded_at   TIMESTAMPTZ,

    CONSTRAINT chk_policy_version_status
        CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),

    CONSTRAINT uq_policy_version_site_label UNIQUE (site_id, version_label),

    CONSTRAINT chk_unacclimatised_thresholds
        CHECK (wbgt_threshold_unacclimatised_light > 15 AND
               wbgt_threshold_unacclimatised_moderate > 15 AND
               wbgt_threshold_unacclimatised_heavy > 15),

    CONSTRAINT chk_partial_thresholds
        CHECK (wbgt_threshold_partial_light > 15 AND
               wbgt_threshold_partial_moderate > 15 AND
               wbgt_threshold_partial_heavy > 15),

    CONSTRAINT chk_full_thresholds
        CHECK (wbgt_threshold_full_light > 15 AND
               wbgt_threshold_full_moderate > 15 AND
               wbgt_threshold_full_heavy > 15),

    CONSTRAINT chk_emergency_stop_threshold
        CHECK (wbgt_emergency_stop > 20 AND wbgt_emergency_stop <= 40),

    CONSTRAINT chk_intensity_ordering
        CHECK (
            wbgt_threshold_unacclimatised_light >= wbgt_threshold_unacclimatised_moderate AND
            wbgt_threshold_unacclimatised_moderate >= wbgt_threshold_unacclimatised_heavy AND
            wbgt_threshold_partial_light >= wbgt_threshold_partial_moderate AND
            wbgt_threshold_partial_moderate >= wbgt_threshold_partial_heavy AND
            wbgt_threshold_full_light >= wbgt_threshold_full_moderate AND
            wbgt_threshold_full_moderate >= wbgt_threshold_full_heavy
        )
);

CREATE INDEX idx_policy_version_site_id ON policy_version(site_id);

-- Exactly one ACTIVE version per site -- this is what makes "the active heat policy"
-- (singular, per the acceptance criteria) a fact the database enforces, not just a
-- convention the application layer has to remember.
CREATE UNIQUE INDEX uq_policy_version_active_per_site
    ON policy_version(site_id) WHERE status = 'ACTIVE';

-- The catalogue is read newest-effective-first; this is the same access pattern as
-- idx_wellbeing_log_latest (V11) -- an index shaped for the one query that matters.
CREATE INDEX idx_policy_version_site_effective_date
    ON policy_version(site_id, effective_date DESC);

-- Carry forward every existing per-site policy as that site's initial ACTIVE version,
-- so a site that already had heat_rest_policy configured keeps evaluating exactly as
-- before -- same thresholds, same PolicyEngineService behaviour -- the moment this
-- migration runs. 'MOM-WBGT-2026.1' matches the version label PolicyEngineService had
-- hardcoded until now, so a recommendation issued right after this migration cites the
-- same version string as one issued right before it.
INSERT INTO policy_version (
    id, site_id, version_label, source, effective_date, status,
    wbgt_threshold_unacclimatised_light, wbgt_threshold_unacclimatised_moderate, wbgt_threshold_unacclimatised_heavy,
    wbgt_threshold_partial_light, wbgt_threshold_partial_moderate, wbgt_threshold_partial_heavy,
    wbgt_threshold_full_light, wbgt_threshold_full_moderate, wbgt_threshold_full_heavy,
    wbgt_emergency_stop, notes, created_at, updated_at, activated_at
)
SELECT
    gen_random_uuid(), hp.site_id, 'MOM-WBGT-2026.1', 'MOM Work-Rest Guidelines 2026 (initial import)',
    hp.created_at::date, 'ACTIVE',
    hp.wbgt_threshold_unacclimatised_light, hp.wbgt_threshold_unacclimatised_moderate, hp.wbgt_threshold_unacclimatised_heavy,
    hp.wbgt_threshold_partial_light, hp.wbgt_threshold_partial_moderate, hp.wbgt_threshold_partial_heavy,
    hp.wbgt_threshold_full_light, hp.wbgt_threshold_full_moderate, hp.wbgt_threshold_full_heavy,
    hp.wbgt_emergency_stop, hp.notes, hp.created_at, hp.updated_at, hp.created_at
FROM heat_rest_policy hp;

DROP TABLE heat_rest_policy;

COMMENT ON TABLE policy_version IS
'Versioned catalogue of site heat-rest policy configurations (SCRUM-120), superseding the
single-row-per-site heat_rest_policy (V9). Every version a Safety Manager configures is
kept; exactly one per site is ACTIVE. PolicyEngineService reads the ACTIVE version and
cites its version_label on every PolicyDecision, so a recommendation can always be traced
to the rule version in force when it was made.
Reference: ADR-013 (UTC storage, SG display timezone).';

COMMENT ON COLUMN policy_version.wbgt_emergency_stop IS
'Critical WBGT threshold (°C) above which all work must cease immediately.
No exceptions regardless of acclimatisation level or work intensity.
Default: 33°C per MOM official guidelines (Band 3: WBGT >= 33°C). Configurable per version.
Reference: MOM Heat Stress Management Standards.';
