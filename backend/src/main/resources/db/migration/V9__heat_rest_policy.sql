-- V6: Heat-Rest Policy Configuration
-- Purpose: Store site-specific heat-rest policy thresholds for SCRUM-117
-- Supports deterministic policy evaluation based on WBGT and acclimatisation level

-- Create heat_rest_policy table
CREATE TABLE IF NOT EXISTS heat_rest_policy (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL UNIQUE REFERENCES site(id) ON DELETE CASCADE,

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

    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Optional notes
    notes TEXT,

    -- Constraints
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

    CONSTRAINT chk_threshold_ordering
        CHECK (wbgt_threshold_unacclimatised_light >= wbgt_threshold_unacclimatised_moderate AND
               wbgt_threshold_unacclimatised_moderate >= wbgt_threshold_unacclimatised_heavy)
);

-- Create indices for fast lookups
CREATE INDEX idx_heat_rest_policy_site_id ON heat_rest_policy(site_id);

-- Add check constraint for light >= moderate >= heavy across all acclimatisation levels
ALTER TABLE heat_rest_policy
ADD CONSTRAINT chk_intensity_ordering
CHECK (
    -- Unacclimatised: light >= moderate >= heavy
    wbgt_threshold_unacclimatised_light >= wbgt_threshold_unacclimatised_moderate AND
    wbgt_threshold_unacclimatised_moderate >= wbgt_threshold_unacclimatised_heavy AND
    -- Partial: light >= moderate >= heavy
    wbgt_threshold_partial_light >= wbgt_threshold_partial_moderate AND
    wbgt_threshold_partial_moderate >= wbgt_threshold_partial_heavy AND
    -- Full: light >= moderate >= heavy
    wbgt_threshold_full_light >= wbgt_threshold_full_moderate AND
    wbgt_threshold_full_moderate >= wbgt_threshold_full_heavy
);

-- Insert default MOM-aligned policy for any existing sites
-- (Sites without a policy will use application defaults)
-- Note: This is commented out to require explicit site policy setup.
-- Each site must have its policy configured via application setup or admin API.
/*
INSERT INTO heat_rest_policy (
    id, site_id,
    wbgt_threshold_unacclimatised_light,
    wbgt_threshold_unacclimatised_moderate,
    wbgt_threshold_unacclimatised_heavy,
    wbgt_threshold_partial_light,
    wbgt_threshold_partial_moderate,
    wbgt_threshold_partial_heavy,
    wbgt_threshold_full_light,
    wbgt_threshold_full_moderate,
    wbgt_threshold_full_heavy,
    wbgt_emergency_stop
)
SELECT
    gen_random_uuid(),
    id,
    25.0, 23.0, 21.0,  -- unacclimatised
    26.0, 24.0, 22.0,  -- partial
    28.0, 26.0, 24.0,  -- full
    33.0               -- emergency (MOM official)
FROM site
WHERE NOT EXISTS (SELECT 1 FROM heat_rest_policy hp WHERE hp.site_id = site.id);
*/

-- Add comment documenting the table
COMMENT ON TABLE heat_rest_policy IS
'Site-specific heat-rest policy configurations per SCRUM-117.
Stores WBGT thresholds for different worker acclimatisation levels and work intensities.
Based on MOM (Ministry of Manpower) guidelines and site risk assessments.
Reference: ADR-002 (heat safety strategy), ADR-013 (UTC storage, SG display timezone).';

COMMENT ON COLUMN heat_rest_policy.wbgt_emergency_stop IS
'Critical WBGT threshold (°C) above which all work must cease immediately.
No exceptions regardless of acclimatisation level or work intensity.
Default: 33°C per MOM official guidelines (Band 3: WBGT >= 33°C). Configurable per site.
Reference: MOM Heat Stress Management Standards.';
