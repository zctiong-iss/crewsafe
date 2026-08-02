package com.crewsafe.common.error;

/**
 * A domain validation failure that must reach the caller as 400, not 500 (e.g. an
 * {@code endsAt} before {@code startsAt}). The message is for the server log only —
 * {@link GlobalExceptionHandler} never returns it to the caller, since this is a
 * general-purpose type and a future call site could construct one from data that isn't
 * safe to echo back.
 *
 * @author Abu Bakar
 */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
