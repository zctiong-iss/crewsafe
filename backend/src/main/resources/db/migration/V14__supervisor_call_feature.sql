-- V14: Supervisor Call Feature (SCRUM-132)
-- Tracks supervisor-worker call sessions for direct communication
-- Enables workers to call supervisors from site/task view

CREATE TABLE supervisor_call_session (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL,
    worker_id UUID NOT NULL,
    supervisor_id UUID NOT NULL,
    call_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    call_duration_seconds INTEGER,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_supervisor_call_site
        FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
    CONSTRAINT fk_supervisor_call_worker
        FOREIGN KEY (worker_id) REFERENCES app_user(id) ON DELETE RESTRICT,
    CONSTRAINT fk_supervisor_call_supervisor
        FOREIGN KEY (supervisor_id) REFERENCES app_user(id) ON DELETE RESTRICT,
    CONSTRAINT ck_call_status
        CHECK (call_status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'MISSED', 'ENDED'))
);

-- Indexes for fast queries
CREATE INDEX idx_supervisor_call_session_site_id
    ON supervisor_call_session(site_id);

CREATE INDEX idx_supervisor_call_session_worker_id
    ON supervisor_call_session(worker_id);

CREATE INDEX idx_supervisor_call_session_supervisor_id
    ON supervisor_call_session(supervisor_id);

CREATE INDEX idx_supervisor_call_session_status
    ON supervisor_call_session(call_status);

CREATE INDEX idx_supervisor_call_session_initiated_at
    ON supervisor_call_session(initiated_at DESC);

-- Table documentation
COMMENT ON TABLE supervisor_call_session IS
    'Tracks supervisor-worker call sessions for SCRUM-132/201 feature. Enables workers to call supervisors directly from site/task view.';
COMMENT ON COLUMN supervisor_call_session.id IS
    'Unique identifier for the call session';
COMMENT ON COLUMN supervisor_call_session.site_id IS
    'Reference to the site where the call is being made';
COMMENT ON COLUMN supervisor_call_session.worker_id IS
    'Reference to the worker initiating the call';
COMMENT ON COLUMN supervisor_call_session.supervisor_id IS
    'Reference to the supervisor being called';
COMMENT ON COLUMN supervisor_call_session.call_status IS
    'Call state: PENDING (waiting), ACCEPTED (active), REJECTED (declined), MISSED (no response), ENDED (completed)';
COMMENT ON COLUMN supervisor_call_session.initiated_at IS
    'Timestamp when worker initiated the call';
COMMENT ON COLUMN supervisor_call_session.accepted_at IS
    'Timestamp when supervisor accepted the call (null if rejected/missed)';
COMMENT ON COLUMN supervisor_call_session.ended_at IS
    'Timestamp when call ended';
COMMENT ON COLUMN supervisor_call_session.call_duration_seconds IS
    'Total call duration in seconds (only set for ACCEPTED calls)';
COMMENT ON COLUMN supervisor_call_session.notes IS
    'Optional notes from worker when initiating call (e.g., reason for call)';
