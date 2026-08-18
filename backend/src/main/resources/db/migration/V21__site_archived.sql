-- V21: soft-archive for sites
-- @author Jemilin Beulah
--
-- Purpose: the new admin console (SCRUM-TBD) removes a site by archiving it, not deleting it
-- — matching this codebase's existing cancel-not-delete convention (SHIFT_CANCELLED vs
-- SHIFT_DELETED). An archived site's policy versions, shifts and memberships are all kept;
-- it just stops appearing in the normal site switcher.

ALTER TABLE site ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN site.archived IS
'Soft-removed by an admin. Archived sites drop out of GET /api/v1/sites and every switcher,
but the row and its policy/shift history are kept.';
