-- SCRUM-291: a scheduled evaluator auto-drafts a recommendation when a site's WBGT band or
-- lightning risk state changes. Two schema additions support it.

-- An auto-triggered draft supersedes rather than stacks on an open PENDING_APPROVAL
-- recommendation for the same shift, per the design doc's dedup guard. SUPERSEDED joins the
-- existing four statuses -- see AgentDraftService#generateAuto for which recommendations may
-- reach it, and RecommendationService#decide for why a superseded recommendation can no
-- longer be decided on.
ALTER TABLE recommendation DROP CONSTRAINT recommendation_status_chk;

ALTER TABLE recommendation
    ADD CONSTRAINT recommendation_status_chk
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED'));

-- Per-site last-seen WBGT band and lightning risk state, so the auto-trigger scheduler can
-- detect a transition instead of re-deriving "did this change" from observation history on
-- every tick. One row per site, upserted every evaluation regardless of whether it fired --
-- see RecommendationAutoTriggerService. The first evaluation for a site has no prior row, so
-- it seeds one without triggering anything: there is nothing yet to compare against.
CREATE TABLE site_condition_state (
    site_id               UUID        PRIMARY KEY REFERENCES site (id),
    last_wbgt_band        VARCHAR(30),
    last_lightning_state  VARCHAR(20),
    last_evaluated_at     TIMESTAMPTZ NOT NULL,

    CONSTRAINT site_condition_state_wbgt_band_chk
        CHECK (last_wbgt_band IN ('BELOW_31', 'BAND_31_TO_BELOW_32', 'BAND_32_TO_BELOW_33', 'BAND_33_AND_ABOVE')),
    CONSTRAINT site_condition_state_lightning_state_chk
        CHECK (last_lightning_state IN ('CLEAR', 'ADVISORY', 'STOP_WORK'))
);
