-- Cache of a recommendation's rationale restated in one locale.
--
-- A plan is drafted ONCE per shift and read MANY times, by people who may each have a
-- different language set -- a Bengali-speaking worker and a Chinese-speaking supervisor can be
-- looking at the same plan. So the translation cannot be a property of the drafting request:
-- it belongs to the (recommendation, locale) pair, which is exactly what this table keys on.
--
-- WHY CACHED RATHER THAN GENERATED UP FRONT. Generating all seven locales at draft time would
-- spend roughly seven times the output tokens on every plan, including the six nobody on that
-- site reads, and would add that latency to a path that may be issuing a stop-work. Translating
-- on first read costs only the languages actually used.
--
-- WHAT IS NOT STORED HERE: a failed translation. ml-service returns the English original with
-- usedFallback=true when Bedrock is unavailable, and the service layer must not write that row
-- -- one outage would otherwise freeze English into that plan for good. See
-- RecommendationTranslationService.
--
-- The recommendation's own `rationale` column is never written to by this feature. It stays the
-- audited record of what the model actually said, in the language it said it in.

CREATE TABLE recommendation_rationale_translation (
    id                UUID         NOT NULL,
    recommendation_id UUID         NOT NULL,
    locale            VARCHAR(16)  NOT NULL,
    translated_text   TEXT         NOT NULL,
    -- Which model produced it, so a translation can be traced the same way a draft can.
    model_id          VARCHAR(200),
    -- The rationale this was made from. If a plan is regenerated, the stored rationale changes
    -- and every translation of the previous one is stale; comparing this catches that without
    -- needing a cache-invalidation step that somebody has to remember to call.
    source_hash       VARCHAR(64)  NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL,

    CONSTRAINT recommendation_rationale_translation_pk PRIMARY KEY (id),
    CONSTRAINT recommendation_rationale_translation_rec_fk
        FOREIGN KEY (recommendation_id) REFERENCES recommendation (id) ON DELETE CASCADE,
    CONSTRAINT recommendation_rationale_translation_uq
        UNIQUE (recommendation_id, locale)
);

CREATE INDEX recommendation_rationale_translation_rec_idx
    ON recommendation_rationale_translation (recommendation_id);
