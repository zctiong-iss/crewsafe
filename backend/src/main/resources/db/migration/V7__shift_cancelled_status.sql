-- SCRUM-255: a supervisor needs "this shift didn't happen" to stay on record (for
-- audit/history) rather than erased outright, which is all DELETE /shifts/{shiftId}
-- (V3) offers today. CANCELLED joins PLANNED/ACTIVE/CLOSED as a fourth, terminal
-- status -- see ShiftStatus and ShiftService#cancelShift for which statuses may reach
-- it.

ALTER TABLE shift DROP CONSTRAINT shift_status_chk;

ALTER TABLE shift
    ADD CONSTRAINT shift_status_chk CHECK (status IN ('PLANNED', 'ACTIVE', 'CLOSED', 'CANCELLED'));
