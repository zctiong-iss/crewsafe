package com.crewsafe.common.error;

/**
 * The request is well-formed and the target exists, but the current state of that target
 * makes the request invalid (e.g. deciding on a recommendation that already has a decision).
 * Must reach the caller as 409, not 400 or 500. The message is for the server log only —
 * {@link GlobalExceptionHandler} never returns it to the caller, same as
 * {@link BadRequestException}.
 *
 * @author Abu Bakar and Justin Chua
 */
public class ConflictException extends RuntimeException {

    /**
     * The machine-readable reason, or null when the conflict is the ordinary lost-write race
     * that {@code errors.conflict} already describes correctly.
     *
     * <p>Never derived from the message. See {@link ErrorCode} for why one is safe to return
     * and the other is not.
     */
    private final ErrorCode code;

    public ConflictException(String message) {
        this(message, null);
    }

    /**
     * @param code names a specific, client-actionable conflict, so mobile can say what is
     *             actually wrong instead of telling a supervisor to reload
     */
    public ConflictException(String message, ErrorCode code) {
        super(message);
        this.code = code;
    }

    public ErrorCode getCode() {
        return code;
    }
}
