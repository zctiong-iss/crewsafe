-- Domain schema for shift planning, WBGT observation, and the recommend/approve/dispatch
-- workflow that the rest of the product builds on. No entity or repository reads or
-- writes these tables yet -- they exist so the schema is ready when that work starts,
-- and so later migrations can extend rather than invent it.
--
-- Adapted from the schema Kumaraguru Surya designed on feature/backend-mvp-skeleton for
-- the same product mockups (shifts, shift_assignments, weather_observations,
-- recommendations, approvals, action_dispatches). Carried forward here with this
-- project's conventions -- singular table names, TIMESTAMPTZ, CHECK-constrained status
-- columns -- and FKs pointed at this project's app_user/site tables. audit_events is not
-- included: audit_event (V1) already covers that need.

CREATE TABLE shift (
    id         UUID        PRIMARY KEY,
    site_id    UUID        NOT NULL REFERENCES site (id),
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ NOT NULL,
    status     VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT shift_status_chk CHECK (status IN ('PLANNED', 'ACTIVE', 'CLOSED'))
);

CREATE INDEX idx_shift_site_id ON shift (site_id);
CREATE INDEX idx_shift_status  ON shift (status);

CREATE TABLE shift_assignment (
    id                  UUID        PRIMARY KEY,
    shift_id            UUID        NOT NULL REFERENCES shift (id),
    worker_id           UUID        NOT NULL REFERENCES app_user (id),
    task_name           VARCHAR(120),
    intensity           VARCHAR(20) NOT NULL DEFAULT 'MODERATE',
    acclimatisation_day INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT shift_assignment_intensity_chk CHECK (intensity IN ('LIGHT', 'MODERATE', 'HEAVY')),
    CONSTRAINT shift_assignment_acclimatisation_day_chk CHECK (acclimatisation_day BETWEEN 1 AND 7)
);

CREATE INDEX idx_shift_assignment_shift_id  ON shift_assignment (shift_id);
CREATE INDEX idx_shift_assignment_worker_id ON shift_assignment (worker_id);

-- source and quality_status distinguish a live NEA reading from a degraded or
-- operator-entered one -- the dashboard and policy engine both need to tell those apart.
CREATE TABLE weather_observation (
    id             UUID         PRIMARY KEY,
    site_id        UUID         NOT NULL REFERENCES site (id),
    wbgt           NUMERIC(5, 2),
    temperature    NUMERIC(5, 2),
    humidity       NUMERIC(5, 2),
    wind_speed     NUMERIC(5, 2),
    rainfall       NUMERIC(7, 2),
    observed_at    TIMESTAMPTZ  NOT NULL,
    ingested_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    source         VARCHAR(50)  NOT NULL DEFAULT 'NEA',
    quality_status VARCHAR(50)  NOT NULL DEFAULT 'LIVE',
    station_id     VARCHAR(100),

    CONSTRAINT weather_observation_source_chk        CHECK (source IN ('NEA', 'MANUAL', 'CACHED')),
    CONSTRAINT weather_observation_quality_status_chk CHECK (quality_status IN ('LIVE', 'DELAYED', 'STALE', 'SIMULATED'))
);

CREATE INDEX idx_weather_observation_site_id     ON weather_observation (site_id);
CREATE INDEX idx_weather_observation_observed_at ON weather_observation (observed_at);

CREATE TABLE recommendation (
    id             UUID        PRIMARY KEY,
    shift_id       UUID        NOT NULL REFERENCES shift (id),
    policy_version VARCHAR(50),
    draft_plan     TEXT,
    status         VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    rationale      TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT recommendation_status_chk CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'))
);

CREATE INDEX idx_recommendation_shift_id ON recommendation (shift_id);
CREATE INDEX idx_recommendation_status   ON recommendation (status);

CREATE TABLE approval (
    id                UUID        PRIMARY KEY,
    recommendation_id UUID        NOT NULL UNIQUE REFERENCES recommendation (id),
    approver_id       UUID        NOT NULL REFERENCES app_user (id),
    decision          VARCHAR(50) NOT NULL,
    reason            TEXT,
    edited_plan       TEXT,
    decided_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT approval_decision_chk CHECK (decision IN ('APPROVED', 'REJECTED', 'EDITED'))
);

CREATE INDEX idx_approval_approver_id ON approval (approver_id);

-- action_code is left open rather than CHECK-constrained: it is a growing catalog of
-- dispatchable actions (REST_10_MIN, REST_15_MIN, HYDRATE, STOP_WORK, ...), not a closed
-- state machine like the status columns above.
CREATE TABLE action_dispatch (
    id            UUID        PRIMARY KEY,
    approval_id   UUID        NOT NULL REFERENCES approval (id),
    worker_id     UUID        NOT NULL REFERENCES app_user (id),
    action_code   VARCHAR(100) NOT NULL,
    instruction   TEXT,
    start_time    TIMESTAMPTZ,
    end_time      TIMESTAMPTZ,
    status        VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT action_dispatch_status_chk CHECK (status IN ('PENDING', 'ACKNOWLEDGED', 'COMPLETED'))
);

CREATE INDEX idx_action_dispatch_approval_id ON action_dispatch (approval_id);
CREATE INDEX idx_action_dispatch_worker_id   ON action_dispatch (worker_id);
CREATE INDEX idx_action_dispatch_status      ON action_dispatch (status);
