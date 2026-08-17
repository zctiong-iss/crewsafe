-- V22: email on app_user, for real Cognito account provisioning
-- @author Jemilin Beulah
--
-- Purpose: POST /api/v1/admin/users can now provision a brand-new Cognito identity directly
-- (AdminCreateUser) instead of only binding an already-existing sub. That path needs an email
-- address to invite -- this column records it. Nullable, no backfill: an account registered
-- by binding an existing identity (the SCRUM-190 synthetic-identity path, or the demo seed)
-- legitimately has no email captured here, forever -- there is nothing to backfill it from.

ALTER TABLE app_user ADD COLUMN email VARCHAR(254);

COMMENT ON COLUMN app_user.email IS
'Set only when this account was provisioned by POST /api/v1/admin/users without a
pre-existing cognitoSub -- the address Cognito emailed the invite to. Null for accounts
registered by binding an already-existing Cognito identity.';
