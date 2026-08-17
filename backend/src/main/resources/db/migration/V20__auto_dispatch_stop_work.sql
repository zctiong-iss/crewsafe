-- SCRUM-440: a lightning-immediate or WBGT-max stop-work bypasses supervisor approval
-- entirely and dispatches straight to workers, so ActionDispatch needs a way to exist
-- without an Approval, and Recommendation needs a status for "the system already acted".

-- Every ActionDispatch has always belonged to exactly one Recommendation, but the only
-- path to it was approval_id -> approval.recommendation_id -- which breaks the moment
-- approval_id can be null. Adding the reference directly, rather than only relaxing
-- approval_id, also fixes a pre-existing gap: ActionDispatchRepository#findByShiftId
-- joined through approval.recommendation.shiftId, an implicit INNER JOIN that would have
-- silently hidden any null-approval row from the SCRUM-317 site action-status stream.
ALTER TABLE action_dispatch
    ADD COLUMN recommendation_id UUID REFERENCES recommendation (id);

UPDATE action_dispatch ad
SET recommendation_id = a.recommendation_id
FROM approval a
WHERE a.id = ad.approval_id
  AND ad.recommendation_id IS NULL;

ALTER TABLE action_dispatch
    ALTER COLUMN recommendation_id SET NOT NULL;

CREATE INDEX idx_action_dispatch_recommendation_id ON action_dispatch (recommendation_id);

-- Now that recommendation_id carries the link every dispatch actually needs, approval_id
-- is only present when a supervisor was the one who decided -- null for an auto-dispatch.
ALTER TABLE action_dispatch
    ALTER COLUMN approval_id DROP NOT NULL;

-- AUTO_DISPATCHED joins the existing five statuses -- see AgentDraftService#doGenerate for
-- which recommendations reach it (lightning STOP_WORK short-circuit, or a WBGT-max mandatory
-- STOP_WORK per PolicyDecision#isEmergencyStop) and RecommendationService#assertCanDecide for
-- why one can no longer be decided on, same reasoning as SUPERSEDED.
ALTER TABLE recommendation DROP CONSTRAINT recommendation_status_chk;

ALTER TABLE recommendation
    ADD CONSTRAINT recommendation_status_chk
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'AUTO_DISPATCHED'));
