package com.crewsafe.common.error;

/**
 * A lookup that found nothing where the caller's path implied something should exist
 * (e.g. no shift with this id under this site). The message is for the server log
 * only — {@link GlobalExceptionHandler} never returns it to the caller, since this is
 * a general-purpose type and a future call site could construct one from data that
 * isn't safe to echo back, same reasoning as {@link BadRequestException}.
 *
 * <p>Every documented 404 in {@code docs/api/} carries a JSON {@code ErrorResponse}
 * body (SCRUM-263) — a controller returning {@code ResponseEntity.notFound().build()}
 * directly bypasses {@link GlobalExceptionHandler} and ships an empty body instead.
 * Throw this from the controller in place of that bare 404.
 *
 * @author Abu Bakar
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
