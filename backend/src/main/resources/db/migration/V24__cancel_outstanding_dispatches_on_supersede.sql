-- Supersede now reaches an APPROVED or AUTO_DISPATCHED recommendation too, not only
-- PENDING_APPROVAL -- its not-yet-acknowledged dispatches are cancelled so a worker never
-- holds instructions from two live plans for one shift at once. See
-- ActionDispatch.ActionDispatchStatus.CANCELLED / ActionDispatchService#cancelOutstanding.

ALTER TABLE action_dispatch DROP CONSTRAINT action_dispatch_status_chk;

ALTER TABLE action_dispatch
    ADD CONSTRAINT action_dispatch_status_chk CHECK (status IN ('PENDING', 'LATE', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED'));
