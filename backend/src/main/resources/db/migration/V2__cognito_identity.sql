-- Cognito now owns credentials, so app_user no longer stores a password. Instead it
-- stores the Cognito "sub" claim, which is how a validated access token is resolved back
-- to a local user, role and set of site memberships.
--
-- This is a straight cutover rather than a phased/nullable migration: there is no data to
-- preserve and no rollback story to protect, since this table has never been used in
-- production. V1 is never edited.
--
-- Consequence worth knowing before reusing this as a template: ADD COLUMN ... NOT NULL with
-- no DEFAULT can only ever run against an empty app_user table. That is true today and the
-- reason the cutover is safe, but it makes this migration permanently unreplayable against
-- any database that has held a row. A later migration adding a NOT NULL column to a
-- populated table must backfill instead: add nullable, backfill, then set NOT NULL.

ALTER TABLE app_user DROP COLUMN password_hash;
ALTER TABLE app_user ADD COLUMN cognito_sub VARCHAR(64) NOT NULL;

CREATE UNIQUE INDEX idx_app_user_cognito_sub ON app_user (cognito_sub);
