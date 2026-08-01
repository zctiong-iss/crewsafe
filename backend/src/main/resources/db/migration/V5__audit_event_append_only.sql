-- SCRUM-183: old audit rows are evidence. Application code, database clients, and
-- accidental JPA dirty checking must never be able to rewrite or remove that evidence.

ALTER TABLE audit_event
    ADD COLUMN correlation_id VARCHAR(100);

-- Rows created before correlation propagation cannot recover their original request id.
-- Give each one an explicit, unique legacy marker rather than leaving ambiguous NULL data.
UPDATE audit_event
SET correlation_id = 'legacy-' || id::text
WHERE correlation_id IS NULL;

-- Older TOKEN_FIRST_SEEN rows did not identify their target. Preserve them with an honest
-- legacy target while making the stronger contract mandatory for every future insert.
UPDATE audit_event
SET target_type = COALESCE(target_type, 'LEGACY_UNKNOWN'),
    target_id = COALESCE(target_id, actor_id, id)
WHERE target_type IS NULL OR target_id IS NULL;

ALTER TABLE audit_event
    ALTER COLUMN correlation_id SET NOT NULL,
    ALTER COLUMN target_type SET NOT NULL,
    ALTER COLUMN target_id SET NOT NULL;

CREATE FUNCTION reject_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_event is append-only: % is forbidden', TG_OP
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_event_append_only
    BEFORE UPDATE OR DELETE ON audit_event
    FOR EACH ROW
    EXECUTE FUNCTION reject_audit_event_mutation();
