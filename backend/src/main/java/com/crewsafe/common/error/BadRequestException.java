package com.crewsafe.common.error;

/**
 * A domain validation failure that must reach the caller as 400, not 500 (e.g. an
 * {@code endsAt} before {@code startsAt}). The message is authored by the throwing code,
 * never an exception's own message, so it is safe to return as-is.
 *
 * @author Abu Bakar
 */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
