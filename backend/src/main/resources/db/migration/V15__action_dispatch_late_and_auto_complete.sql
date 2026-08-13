-- SCRUM-324: implements the state machine SCRUM-317 defined. LATE joins the existing
-- action_dispatch statuses (timer-driven, set by the ack-window sweep), late_at records
-- when that happened, and completed_by distinguishes a worker's complete tap from the
-- auto-complete sweep -- see ActionDispatch.ActionDispatchStatus / CompletionSource.

ALTER TABLE action_dispatch DROP CONSTRAINT action_dispatch_status_chk;

ALTER TABLE action_dispatch
    ADD CONSTRAINT action_dispatch_status_chk CHECK (status IN ('PENDING', 'LATE', 'ACKNOWLEDGED', 'COMPLETED'));

ALTER TABLE action_dispatch
    ADD COLUMN late_at      TIMESTAMPTZ,
    ADD COLUMN completed_by VARCHAR(10) CHECK (completed_by IN ('WORKER', 'SYSTEM'));
