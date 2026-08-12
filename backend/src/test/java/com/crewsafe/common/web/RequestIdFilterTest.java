package com.crewsafe.common.web;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Unit tests for RequestIdFilter (SCRUM-180).
 *
 * @author Abu Bakar
 */
class RequestIdFilterTest {

    private final RequestIdFilter filter = new RequestIdFilter();

    @Test
    void generatesAnIdWhenNoneSupplied() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();
        String[] mdcDuringRequest = new String[1];
        FilterChain chain = (req, res) -> mdcDuringRequest[0] = MDC.get("requestId");

        filter.doFilter(request, response, chain);

        String returned = response.getHeader(RequestIdFilter.HEADER);
        assertNotNull(returned);
        assertDoesNotThrow_isUuid(returned);
        assertEquals(returned, mdcDuringRequest[0], "MDC must carry the same id handed to the response");
    }

    @Test
    void reusesAValidInboundId() throws Exception {
        String inbound = UUID.randomUUID().toString();
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(RequestIdFilter.HEADER, inbound);
        MockHttpServletResponse response = new MockHttpServletResponse();
        String[] mdcDuringRequest = new String[1];
        FilterChain chain = (req, res) -> mdcDuringRequest[0] = MDC.get("requestId");

        filter.doFilter(request, response, chain);

        assertEquals(inbound, response.getHeader(RequestIdFilter.HEADER));
        assertEquals(inbound, mdcDuringRequest[0]);
    }

    @Test
    void ignoresAMalformedInboundIdAndGeneratesInstead() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(RequestIdFilter.HEADER, "not-a-uuid; DROP everything\nforged log line");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> { });

        String returned = response.getHeader(RequestIdFilter.HEADER);
        assertNotNull(returned);
        assertNotEquals("not-a-uuid; DROP everything\nforged log line", returned);
        assertDoesNotThrow_isUuid(returned);
        assertTrue(!returned.contains("\n") && !returned.contains("\r"));
    }

    @Test
    void clearsMdcAfterTheRequestSoPooledThreadsDontLeakIds() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, (req, res) -> { });

        assertNull(MDC.get("requestId"));
    }

    @Test
    void clearsMdcWhenTheRequestFails() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThrows(IllegalStateException.class, () ->
                filter.doFilter(request, response, (req, res) -> {
                    assertNotNull(MDC.get("requestId"));
                    throw new IllegalStateException("synthetic failure");
                }));

        assertNull(MDC.get("requestId"));
    }

    private void assertDoesNotThrow_isUuid(String value) {
        assertTrue(value.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"),
                "expected a canonical UUID, got: " + value);
    }
}
