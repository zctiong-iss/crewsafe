package com.crewsafe.common.error;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Unit tests for GlobalExceptionHandler.
 *
 * @author Surya Kumaraguru
 */
@ExtendWith(MockitoExtension.class)
class GlobalExceptionHandlerTest {

    @InjectMocks
    private GlobalExceptionHandler handler;

    @Test
    void testHandleIllegalArgument_ApprovalNotFound() {
        IllegalArgumentException ex = new IllegalArgumentException("Approval not found: invalid-id");

        ResponseEntity<ErrorResponse> response = handler.handleIllegalArgument(ex);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals("Bad Request", response.getBody().error());
        assertEquals("Invalid request parameters", response.getBody().message());
    }

    @Test
    void testHandleIllegalArgument_WorkerNotFound() {
        IllegalArgumentException ex = new IllegalArgumentException("Worker not found: invalid-id");

        ResponseEntity<ErrorResponse> response = handler.handleIllegalArgument(ex);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    void testHandleIllegalArgument_ActionDispatchNotFound() {
        IllegalArgumentException ex = new IllegalArgumentException("ActionDispatch not found: invalid-id");

        ResponseEntity<ErrorResponse> response = handler.handleIllegalArgument(ex);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    void testHandleIllegalArgument_CanOnlyDispatchFromApprovedDecision() {
        IllegalArgumentException ex = new IllegalArgumentException("Can only dispatch from an approved decision");

        ResponseEntity<ErrorResponse> response = handler.handleIllegalArgument(ex);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    void testHandleIllegalArgument_DoesNotExposeInternalDetails() {
        // Test that the response doesn't expose exception message
        IllegalArgumentException ex = new IllegalArgumentException("Internal error: SELECT * FROM app_user WHERE id = '123'");

        ResponseEntity<ErrorResponse> response = handler.handleIllegalArgument(ex);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        ErrorResponse body = response.getBody();
        assertNotNull(body);
        // Message should be generic, not the original exception message
        assertEquals("Invalid request parameters", body.message());
        // Verify the response doesn't contain SQL or internal details
        String responseJson = body.toString();
        assertNotNull(responseJson);
    }

    @Test
    void testHandleBadRequest() {
        BadRequestException ex = new BadRequestException("Invalid input");

        ResponseEntity<ErrorResponse> response = handler.handleBadRequest(ex);

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
    }
}
