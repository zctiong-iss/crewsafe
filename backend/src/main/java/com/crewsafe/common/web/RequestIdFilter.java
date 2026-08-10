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
 * Tags every request with a correlation id, so a failure a user reports can be found in the
 * logs, and so the audit trail can be tied back to the request that produced it (SCRUM-180).
 *
 * <p>The id goes four places: the {@code X-Request-Id} response header, the SLF4J MDC (so
 * every log line for the request carries it — see the logging pattern in application.yml),
 * the body of any error response, and every audit event written during the request (via
 * {@link #currentOrGenerated()}, which {@code AuditService} calls). That is the whole point:
 * error responses deliberately say nothing about what went wrong, so without a handle like
 * this, "it failed at about 3pm" is all anyone has to go on.
 *
 * <p>An inbound {@code X-Request-Id} is reused only if it is a syntactically valid UUID —
 * the same shape we generate ourselves. That is the entire defence against log injection: a
 * value that parses as a UUID cannot contain a newline or any other character that could
 * forge a log entry, so validating the shape is sufficient and no separate sanitisation step
 * is needed. Anything that isn't a UUID (missing, blank, malformed) falls back to a freshly
 * generated one, exactly as before. UUID was chosen as the one correlation id format for the
 * whole system — this is also the id that Sprint 3's audit export and LangSmith trace
 * correlation (SCRUM-151, SCRUM-122) will consume, so the format is fixed here rather than
 * left to be retrofitted later.
 *
 * <p>Ordered first so the id exists before Spring Security runs: the 401 it writes for an
 * unauthenticated request needs one too, and that happens well before any controller.
 *
 * @author Jemilin Beulah and Abu Bakar
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
        String requestId = resolveRequestId(request);
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

    /**
     * Reuses the caller-supplied {@value #HEADER} if it is a valid UUID; generates one
     * otherwise. {@link UUID#fromString} both validates and normalises (e.g. lower-cases the
     * hex digits), so the value stamped on this request is always in canonical form.
     */
    private String resolveRequestId(HttpServletRequest request) {
        String inbound = request.getHeader(HEADER);
        if (inbound != null) {
            try {
                return UUID.fromString(inbound).toString();
            } catch (IllegalArgumentException notAUuid) {
                // Falls through to generating a fresh id below.
            }
        }
        return UUID.randomUUID().toString();
    }
}
