-- SCRUM-170: lightning ingest and stop-work state derivation.
-- @author Jemilin Beulah
--
-- One row per site per ingestion tick, mirroring weather_observation (V3/V4). Distance and
-- freshness are recomputed at read time from these rows, not trusted from storage — see
-- LightningRiskDerivationService — so nearest_strike_km and nearest_strike_at may both be
-- NULL when a tick observed no strikes at all; that is a valid "no strike this tick"
-- result, not a missing value.

CREATE TABLE lightning_observation (
    id                 UUID         PRIMARY KEY,
    site_id            UUID         NOT NULL REFERENCES site (id),
    nearest_strike_km  NUMERIC(6, 2),
    nearest_strike_at  TIMESTAMPTZ,
    observed_at        TIMESTAMPTZ  NOT NULL,
    ingested_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    source             VARCHAR(50)  NOT NULL DEFAULT 'NEA',
    quality_status     VARCHAR(50)  NOT NULL DEFAULT 'LIVE',

    CONSTRAINT lightning_observation_source_chk        CHECK (source IN ('NEA', 'MANUAL', 'CACHED')),
    CONSTRAINT lightning_observation_quality_status_chk CHECK (quality_status IN ('LIVE', 'DELAYED', 'STALE', 'SIMULATED')),
    -- Same concurrency boundary as weather_observation_ingest_unique (V4): the scheduler may
    -- retry, multiple instances may overlap, and NEA may repeat an observation across polls.
    CONSTRAINT lightning_observation_ingest_unique     UNIQUE (site_id, observed_at, source)
);

-- Supports both "latest for this site" and the risk-derivation lookback window query.
CREATE INDEX idx_lightning_observation_site_recent ON lightning_observation (site_id, observed_at DESC);
