package com.crewsafe.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * Tags every request with an id, so a failure a user reports can be found in the logs.
 *
 * <p>The id goes three places: the {@code X-Request-Id} response header, the SLF4J MDC (so
 * every log line for the request carries it — see the logging pattern in application.yml),
 * and the body of any error response. That is the whole point: error responses deliberately
 * say nothing about what went wrong, so without a handle like this, "it failed at about
 * 3pm" is all anyone has to go on.
 *
 * <p>The id is always generated here and an inbound {@code X-Request-Id} is ignored. Echoing
 * a caller-supplied value would be convenient for tracing across services, but it lets a
 * caller write arbitrary text into our logs — newlines and all — which is how forged log
 * entries get planted. If this ever sits behind a gateway that propagates trace ids, take
 * the value from there and sanitise it rather than trusting the client.
 *
 * <p>Ordered first so the id exists before Spring Security runs: the 401 it writes for an
 * unauthenticated request needs one too, and that happens well before any controller.
 *
 * @author Jemilin Beulah
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    private static final String MDC_KEY = "requestId";

    /** The current request's id, for building an error body. */
    public static String current() {
        String requestId = MDC.get(MDC_KEY);
        return requestId != null ? requestId : "unknown";
    }

    /**
     * Returns the current request id, or creates one for work running outside an HTTP
     * request. Audit records must always carry a useful correlation id, including events
     * emitted by future schedulers or message consumers.
     */
    public static String currentOrGenerated() {
        String requestId = MDC.get(MDC_KEY);
        return requestId != null && !requestId.isBlank()
                ? requestId
                : UUID.randomUUID().toString();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString();
        MDC.put(MDC_KEY, requestId);
        response.setHeader(HEADER, requestId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            // Threads are pooled and reused. Leaving the value behind would stamp the next,
            // unrelated request with this one's id.
            MDC.remove(MDC_KEY);
        }
    }
}
