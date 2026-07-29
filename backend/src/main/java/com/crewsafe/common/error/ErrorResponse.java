package com.crewsafe.common.error;

import com.crewsafe.common.web.RequestIdFilter;

/**
 * The single shape of every error this API returns.
 *
 * <p>{@code error} is the HTTP reason phrase and {@code message} is a fixed, category-level
 * sentence — never an exception message, which routinely carries a SQL fragment, a class
 * name or a file path. {@code requestId} is the one piece of request-specific detail that is
 * safe to hand back: it identifies the request without describing it, so a user can quote it
 * and we can find the full story in our own logs.
 *
 * @author Jemilin Beulah
 */
public record ErrorResponse(String error, String message, String requestId) {

    public static ErrorResponse of(String error, String message) {
        return new ErrorResponse(error, message, RequestIdFilter.current());
    }
}
