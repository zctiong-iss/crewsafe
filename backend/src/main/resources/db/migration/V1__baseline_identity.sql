-- Baseline identity schema: users, sites, site membership and the audit trail.
--
-- Site membership is the basis of FR-03 ("a user shall only access sites to which they
-- are assigned"). It is a table rather than a token claim on purpose: memberships change
-- mid-shift, and a claim baked into a 15-minute token would grant access that has already
-- been revoked.

CREATE TABLE app_user (
    id            UUID         PRIMARY KEY,
    username      VARCHAR(64)  NOT NULL UNIQUE,
    password_hash VARCHAR(120) NOT NULL,
    display_name  VARCHAR(120) NOT NULL,
    role          VARCHAR(32)  NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT app_user_role_chk   CHECK (role IN ('WORKER', 'SUPERVISOR', 'SAFETY_MANAGER', 'ADMIN')),
    CONSTRAINT app_user_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE site (
    id         UUID          PRIMARY KEY,
    name       VARCHAR(120)  NOT NULL,
    latitude   NUMERIC(9, 6) NOT NULL,
    longitude  NUMERIC(9, 6) NOT NULL,
    timezone   VARCHAR(64)   NOT NULL DEFAULT 'Asia/Singapore',
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE site_membership (
    id         UUID        PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    site_id    UUID        NOT NULL REFERENCES site (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT site_membership_unique UNIQUE (user_id, site_id)
);

CREATE INDEX idx_site_membership_user ON site_membership (user_id);
CREATE INDEX idx_site_membership_site ON site_membership (site_id);

-- Append-only audit trail (FR-04). actor_id is nullable because a failed login has no
-- authenticated actor, yet still must be recorded.
CREATE TABLE audit_event (
    id          UUID         PRIMARY KEY,
    actor_id    UUID         REFERENCES app_user (id),
    event_type  VARCHAR(64)  NOT NULL,
    target_type VARCHAR(64),
    target_id   UUID,
    detail      VARCHAR(500),
    occurred_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_event_occurred ON audit_event (occurred_at DESC);
CREATE INDEX idx_audit_event_actor    ON audit_event (actor_id);
