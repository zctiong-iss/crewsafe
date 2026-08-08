package com.crewsafe.common.error;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Turns unhandled exceptions into JSON.
 *
 * Responses carry a category, never a stack trace or an exception message. An exception
 * message routinely contains a SQL fragment, a class name or a file path — all of which
 * tell an attacker about internals they should have to guess. Each response does carry a
 * {@code requestId}, which is how a report of "it broke" becomes findable in the logs.
 *
 * @author Jemilin Beulah and Abu Bakar
 */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("Bad Request", "Invalid request parameters"));
    }

    /**
     * The message is logged, not returned — this file's rule is no exception message ever
     * reaches the caller, and {@link BadRequestException} is a general-purpose type any
     * future call site could construct from data that isn't actually safe to echo back.
     */
    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<ErrorResponse> handleBadRequest(BadRequestException e) {
        log.debug("Bad request: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("Bad Request", "Invalid request parameters"));
    }

    /**
     * The message is logged, not returned, same reasoning as {@link #handleBadRequest}.
     * A controller throws this in place of building a bare {@code notFound()} directly,
     * so every documented 404 carries the same JSON {@link ErrorResponse} body as every
     * other error (SCRUM-263) — reusing the "Not Found"/"No such resource" pair {@link
     * #handleNotFound(NoResourceFoundException)} already uses for an unmapped URL, since
     * both describe the same thing to the caller.
     */
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleResourceNotFound(ResourceNotFoundException e) {
        log.debug("Resource not found: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("Not Found", "No such resource"));
    }

    /**
     * Handles {@link IllegalArgumentException} from business logic validation.
     * Prevents typo'd or invalid IDs from returning 500 — bad input returns 400,
     * matching the BadRequestException pattern.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(IllegalArgumentException e) {
        log.debug("Invalid argument: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("Bad Request", "Invalid request parameters"));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadableBody(HttpMessageNotReadableException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("Bad Request", "Malformed request body"));
    }

    /**
     * A path variable that will not convert — most often a malformed UUID.
     *
     * Without this the catch-all below reports 500, which is both wrong and alarming: the
     * caller sent a bad request and nothing on the server actually failed.
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("Bad Request", "Invalid request parameters"));
    }

    /**
     * An unmapped URL. Also a 500 under the catch-all otherwise, which would make routine
     * scanner traffic look like a server on fire.
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("Not Found", "No such resource"));
    }

    /**
     * Must be declared explicitly.
     *
     * {@code @PreAuthorize} throws this from inside the controller invocation, so without
     * a dedicated handler the catch-all below would turn every authorization failure into
     * a 500 — hiding a working security control behind what looks like a server bug.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDenied(AccessDeniedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("Forbidden", "Access denied"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        // Logged in full for us, generic for the caller. The log line carries the same
        // requestId the caller is handed, which is what ties the two together.
        log.error("Unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse.of("Internal Server Error", "An unexpected error occurred"));
    }
}
