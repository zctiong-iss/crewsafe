-- SCRUM-166: the scheduler may retry a poll, multiple instances may overlap, and the NEA
-- API may return the same observation for several polling intervals. The database is the
-- final concurrency boundary: only one logical observation per site/time/source may exist.

ALTER TABLE weather_observation
    ADD CONSTRAINT weather_observation_ingest_unique
        UNIQUE (site_id, observed_at, source);

-- Supports the common "latest conditions for this site" lookup used by the dashboard.
CREATE INDEX idx_weather_observation_site_latest
    ON weather_observation (site_id, observed_at DESC);
