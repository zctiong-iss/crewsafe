-- SCRUM-359 (raised from the mobile analysis of SCRUM-118, built alongside SCRUM-289):
-- §12.2 requires a recommendation to always surface the data it was based on, how old that
-- data was, and which model and policy version produced it. policy_version already existed;
-- the readings and the model did not, so mobile could render the rationale and the rule
-- references and then had to stop.
--
-- evidence is JSON rather than nine columns because it is a snapshot, read as a unit and
-- never queried across. Its shape is RecommendationEvidence (observedWbgt, forecastWbgt30m,
-- currentBand, forecastBand, observedAt, freshness, source, stationId, lightningState).
--
-- Both columns are nullable and neither is backfilled. Every recommendation that exists today
-- predates the agent, and the readings that produced them were never recorded anywhere -- so
-- there is nothing truthful to backfill with, and inventing values for an evidence block whose
-- entire purpose is auditability would defeat it. Clients must treat null as "not recorded".

ALTER TABLE recommendation
    ADD COLUMN evidence      TEXT,
    ADD COLUMN model_version VARCHAR(100);

COMMENT ON COLUMN recommendation.evidence IS
    'JSON snapshot of the conditions at draft time (RecommendationEvidence). Null for rows drafted before SCRUM-359.';

COMMENT ON COLUMN recommendation.model_version IS
    'Bedrock model id that drafted the plan, or a deterministic-fallback sentinel when no model was used. Null for rows drafted before SCRUM-359.';
