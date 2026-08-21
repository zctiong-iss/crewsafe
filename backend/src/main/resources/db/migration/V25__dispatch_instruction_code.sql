-- A dispatch now carries the code a client needs to render its instruction in the worker's
-- own language, alongside the English text the plan was written with.
--
-- The existing action_code cannot do this job. It is the DISPATCH code, which collapses
-- HYDRATE_HOURLY and HYDRATE_REGULARLY to HYDRATE and SHADE_RECOVERY to SEEK_SHADE -- right
-- for grouping, wrong for wording, since those sentences say different things. And a lightning
-- stop-work shares STOP_WORK with a heat stop-work while instructing the crew into a building
-- rather than into shade. See mitigation/domain/InstructionCatalogue.java.
--
-- NULLABLE, and deliberately not backfilled. Existing rows were written from
-- MitigationSuggestion.action, whose text the client can still match against the deterministic
-- table it already ships. A backfill would have to guess which of the two hydration sentences
-- a collapsed HYDRATE row meant, and guessing wrong would silently change a safety instruction
-- that a worker has already acknowledged. A null reads as "fall back to the text", which is
-- exactly the behaviour that shipped before this column existed.

ALTER TABLE action_dispatch
    ADD COLUMN instruction_code VARCHAR(100);

COMMENT ON COLUMN action_dispatch.instruction_code IS
    'Translatable instruction key; null means render the instruction text verbatim.';
