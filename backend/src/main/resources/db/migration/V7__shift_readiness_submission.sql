CREATE TABLE readiness_submission (
    id UUID PRIMARY KEY,
    -- A bare UUID deliberately preserves this immutable record if its shift is deleted.
    shift_id UUID NOT NULL,
    worker_id UUID NOT NULL REFERENCES app_user(id),
    fit_to_work BOOLEAN NOT NULL,
    adequate_sleep BOOLEAN NOT NULL,
    adequate_hydration BOOLEAN NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE readiness_submission_symptom (
    readiness_submission_id UUID NOT NULL REFERENCES readiness_submission(id) ON DELETE CASCADE,
    symptom VARCHAR(30) NOT NULL CHECK (symptom IN (
        'NONE', 'DIZZINESS', 'NAUSEA', 'HEADACHE', 'FATIGUE', 'MUSCLE_CRAMPS', 'OTHER'
    )),
    PRIMARY KEY (readiness_submission_id, symptom)
);

-- Latest-wins reads remain quick while every earlier submission stays in history.
CREATE INDEX idx_readiness_submission_latest
    ON readiness_submission (shift_id, worker_id, submitted_at DESC, id DESC);
