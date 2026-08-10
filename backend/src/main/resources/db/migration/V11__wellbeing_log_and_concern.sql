-- V11: Worker wellbeing logs and concerns (US-11 / F-12)
--
-- Two tables, deliberately not one. A rest or a hydration is a fact with no state — it
-- happened, at a time, and nothing further is ever true of it. A concern has a life: someone
-- raises it, someone else has to see it, and "has anyone looked at this" is the question the
-- supervisor screen exists to answer. Folding them together would give every drink of water a
-- status column that is meaningless for all but a fraction of the rows.
--
-- Both reference worker_id and shift_id as bare UUIDs against app_user/shift respectively,
-- matching readiness_submission (V7): the shift FK is deliberately absent so an immutable
-- record of what a worker reported survives its shift being deleted.

CREATE TABLE wellbeing_log (
    id         UUID        PRIMARY KEY,
    shift_id   UUID        NOT NULL,
    worker_id  UUID        NOT NULL REFERENCES app_user (id),

    -- REST or HYDRATION. Never free text: the supervisor view groups by this, and a typo
    -- would silently create a third category nobody is looking at.
    log_type   VARCHAR(20) NOT NULL,

    -- SELF when the worker tapped the button, INSTRUCTED when a dispatched rest ran to
    -- completion. Both are real rest; conflating them would hide whether a crew rests only
    -- when told to, which is exactly what a supervisor needs to know.
    source     VARCHAR(20) NOT NULL DEFAULT 'SELF',

    -- The dispatch this came from, for an INSTRUCTED log. Null for a self-logged one.
    -- Unique so a dispatch completed twice — a retry, a double tap — cannot log two rests.
    dispatch_id UUID UNIQUE,

    logged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT wellbeing_log_type_chk   CHECK (log_type IN ('REST', 'HYDRATION')),
    CONSTRAINT wellbeing_log_source_chk CHECK (source IN ('SELF', 'INSTRUCTED')),
    -- An INSTRUCTED log without the dispatch that caused it cannot be traced back, and a
    -- SELF log with one is a contradiction.
    CONSTRAINT wellbeing_log_dispatch_chk CHECK (
        (source = 'INSTRUCTED' AND dispatch_id IS NOT NULL)
        OR (source = 'SELF' AND dispatch_id IS NULL)
    )
);

-- The supervisor view asks one question per worker: when did they last rest, and last drink?
-- This index answers it directly rather than by scanning a shift's whole history.
CREATE INDEX idx_wellbeing_log_latest
    ON wellbeing_log (shift_id, worker_id, log_type, logged_at DESC, id DESC);

CREATE TABLE concern (
    id            UUID        PRIMARY KEY,
    shift_id      UUID        NOT NULL,
    worker_id     UUID        NOT NULL REFERENCES app_user (id),

    -- Optional, and optional on purpose: the symptom chips carry the meaning that has to
    -- survive translation, and a worker should never be blocked from raising a concern
    -- because they cannot type in a language their supervisor reads.
    note          TEXT,

    -- OPEN until a supervisor acknowledges it. There is no RESOLVED: this app cannot know
    -- whether the underlying problem went away, only whether someone has seen the report.
    status        VARCHAR(20) NOT NULL DEFAULT 'OPEN',

    raised_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES app_user (id),

    CONSTRAINT concern_status_chk CHECK (status IN ('OPEN', 'ACKNOWLEDGED')),
    -- An acknowledged concern must say who and when; an open one must claim neither.
    CONSTRAINT concern_acknowledgement_chk CHECK (
        (status = 'ACKNOWLEDGED' AND acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)
        OR (status = 'OPEN' AND acknowledged_at IS NULL AND acknowledged_by IS NULL)
    )
);

-- Open concerns first and newest first is the only order this is ever read in.
CREATE INDEX idx_concern_shift_status ON concern (shift_id, status, raised_at DESC);

-- Same vocabulary and the same shape as readiness_submission_symptom (V7). Reused rather
-- than reinvented: these are the symptoms already translated in all seven locales, and a
-- second competing list would mean a worker reporting "dizziness" in two places that a
-- report could not join on.
CREATE TABLE concern_symptom (
    concern_id UUID        NOT NULL REFERENCES concern (id) ON DELETE CASCADE,
    symptom    VARCHAR(30) NOT NULL CHECK (symptom IN (
        'NONE', 'DIZZINESS', 'NAUSEA', 'HEADACHE', 'FATIGUE', 'MUSCLE_CRAMPS', 'OTHER'
    )),
    PRIMARY KEY (concern_id, symptom)
);
