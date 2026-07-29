-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    cognito_subject VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(255),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE INDEX idx_users_cognito_subject ON users(cognito_subject);
CREATE INDEX idx_users_email ON users(email);

-- Sites table
CREATE TABLE sites (
    id UUID PRIMARY KEY,
    name VARCHAR(255),
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    timezone VARCHAR(50),
    created_at TIMESTAMP
);

-- Shifts table
CREATE TABLE shifts (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL,
    starts_at TIMESTAMP,
    ends_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'PLANNED',
    created_at TIMESTAMP,
    FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE INDEX idx_shifts_site_id ON shifts(site_id);
CREATE INDEX idx_shifts_status ON shifts(status);

-- Shift assignments table
CREATE TABLE shift_assignments (
    id UUID PRIMARY KEY,
    shift_id UUID NOT NULL,
    worker_id UUID NOT NULL,
    task_name VARCHAR(255),
    intensity VARCHAR(20) DEFAULT 'MODERATE',
    acclimatisation_day INTEGER,
    created_at TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id),
    FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX idx_shift_assignments_shift_id ON shift_assignments(shift_id);
CREATE INDEX idx_shift_assignments_worker_id ON shift_assignments(worker_id);

-- Weather observations table
CREATE TABLE weather_observations (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL,
    wbgt NUMERIC(5, 2),
    temperature NUMERIC(5, 2),
    humidity NUMERIC(5, 2),
    wind_speed NUMERIC(5, 2),
    rainfall NUMERIC(7, 2),
    observed_at TIMESTAMP,
    ingested_at TIMESTAMP,
    source VARCHAR(50) DEFAULT 'NEA',
    quality_status VARCHAR(50) DEFAULT 'LIVE',
    station_id VARCHAR(100),
    FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE INDEX idx_weather_observations_site_id ON weather_observations(site_id);
CREATE INDEX idx_weather_observations_observed_at ON weather_observations(observed_at);

-- Recommendations table
CREATE TABLE recommendations (
    id UUID PRIMARY KEY,
    shift_id UUID NOT NULL,
    policy_version VARCHAR(50),
    draft_plan TEXT,
    status VARCHAR(50) DEFAULT 'DRAFT',
    rationale TEXT,
    created_at TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE INDEX idx_recommendations_shift_id ON recommendations(shift_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);

-- Approvals table
CREATE TABLE approvals (
    id UUID PRIMARY KEY,
    recommendation_id UUID NOT NULL UNIQUE,
    approver_id UUID NOT NULL,
    decision VARCHAR(50),
    reason TEXT,
    edited_plan TEXT,
    decided_at TIMESTAMP,
    FOREIGN KEY (recommendation_id) REFERENCES recommendations(id),
    FOREIGN KEY (approver_id) REFERENCES users(id)
);

CREATE INDEX idx_approvals_recommendation_id ON approvals(recommendation_id);
CREATE INDEX idx_approvals_approver_id ON approvals(approver_id);

-- Action dispatches table
CREATE TABLE action_dispatches (
    id UUID PRIMARY KEY,
    approval_id UUID NOT NULL,
    worker_id UUID NOT NULL,
    action_code VARCHAR(100),
    instruction TEXT,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    status VARCHAR(50) DEFAULT 'PENDING',
    dispatched_at TIMESTAMP,
    FOREIGN KEY (approval_id) REFERENCES approvals(id),
    FOREIGN KEY (worker_id) REFERENCES users(id)
);

CREATE INDEX idx_action_dispatches_approval_id ON action_dispatches(approval_id);
CREATE INDEX idx_action_dispatches_worker_id ON action_dispatches(worker_id);
CREATE INDEX idx_action_dispatches_status ON action_dispatches(status);

-- Audit events table (append-only)
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    actor_id UUID,
    event_type VARCHAR(100),
    target_type VARCHAR(100),
    target_id UUID,
    details TEXT,
    occurred_at TIMESTAMP,
    FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX idx_audit_events_actor_id ON audit_events(actor_id);
CREATE INDEX idx_audit_events_target_id ON audit_events(target_id);
CREATE INDEX idx_audit_events_event_type ON audit_events(event_type);
CREATE INDEX idx_audit_events_occurred_at ON audit_events(occurred_at);
