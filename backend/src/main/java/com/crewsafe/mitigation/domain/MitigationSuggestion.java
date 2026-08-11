package com.crewsafe.mitigation.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * One suggested mitigation on a recommendation.
 *
 * <p>{@code actionCode} and {@code category} were added by SCRUM-119 and are nullable on purpose.
 * The field the mobile app can act on is {@code actionCode}: it renders {@code t("actions." +
 * actionCode)} in the worker's own language, where {@code action} is server-authored English prose
 * that no client can translate. Clients must therefore prefer the code and treat {@code action} as
 * the fallback — never the other way round, and never by parsing the prose, which works in English
 * and fails in the other six locales.
 *
 * <p>Nullable rather than required because rows already exist. {@code recommendation.draft_plan}
 * holds a serialised {@link Batch} written before these fields existed, and those rows must keep
 * deserialising — hence {@code @JsonIgnoreProperties(ignoreUnknown = true)} for the reverse
 * direction too, so a plan written by a later, richer agent still loads here.
 *
 * @author Surya Kumaraguru
 * @author Justin Chua
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record MitigationSuggestion(
    String priority,
    String action,
    String rationale,
    String estimatedImpact,
    /** From {@link ActionCatalogue}. Null on plans drafted before SCRUM-119. */
    String actionCode,
    /** The topic a client groups this under. Derivable from the code; carried so clients need no table. */
    String category
) {
    /**
     * The shape before SCRUM-119, kept so existing callers and fixtures compile unchanged.
     *
     * <p>A mitigation built this way carries no action code, so it dispatches under the legacy
     * placeholder and reaches the worker as untranslated prose. New callers should give a code.
     */
    public MitigationSuggestion(String priority, String action, String rationale, String estimatedImpact) {
        this(priority, action, rationale, estimatedImpact, null, null);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Batch(List<MitigationSuggestion> mitigations) {}
}
