package com.crewsafe.common.error;

/**
 * The request is well-formed and the target exists, but the current state of that target
 * makes the request invalid (e.g. deciding on a recommendation that already has a decision).
 * Must reach the caller as 409, not 400 or 500. The message is for the server log only —
 * {@link GlobalExceptionHandler} never returns it to the caller, same as
 * {@link BadRequestException}.
 *
 * @author Abu Bakar
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
