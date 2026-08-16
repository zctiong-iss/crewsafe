package com.crewsafe.common.error;

import com.crewsafe.common.web.RequestIdFilter;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The single shape of every error this API returns.
 *
 * <p>{@code error} is the HTTP reason phrase and {@code message} is a fixed, category-level
 * sentence — never an exception message, which routinely carries a SQL fragment, a class
 * name or a file path. {@code requestId} is the one piece of request-specific detail that is
 * safe to hand back: it identifies the request without describing it, so a user can quote it
 * and we can find the full story in our own logs.
 *
 * <p>{@code code} is an optional {@link ErrorCode} naming a specific, client-actionable
 * reason. It is omitted from the JSON entirely when absent, so every response that existed
 * before it was added is byte-identical and no client needs to change to keep working.
 *
 * @author Jemilin Beulah and Justin Chua
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorResponse(String error, String message, String requestId, ErrorCode code) {

    public static ErrorResponse of(String error, String message) {
        return of(error, message, null);
    }

    public static ErrorResponse of(String error, String message, ErrorCode code) {
        return new ErrorResponse(error, message, RequestIdFilter.current(), code);
    }
}
