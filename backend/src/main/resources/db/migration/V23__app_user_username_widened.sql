-- V23: widen app_user.username to hold an email
-- @author Jemilin Beulah
--
-- Purpose: registering by email (V22) no longer asks the admin for a separate username --
-- UserAdminService.register sets username = email directly, since username's only real job
-- today is a unique local handle (auth resolves purely by cognito_sub; see
-- CognitoJwtAuthenticationConverter). The original VARCHAR(64) predates Cognito entirely
-- (V1's self-issued-JWT design) and is too narrow for an arbitrary email address.

ALTER TABLE app_user ALTER COLUMN username TYPE VARCHAR(254);
