package com.crewsafe.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-IP rate limit on the login endpoint.
 *
 * <p>Without it, the login endpoint is an unlimited password-guessing oracle: BCrypt makes
 * each attempt slow, but nothing stops an attacker making them all night. The project's
 * security testing plan requires a rate limit on login.
 *
 * <p>Applied only to {@code POST /api/v1/auth/login}. Rate-limiting authenticated endpoints
 * would need a different key (the user, not the IP) and a different budget.
 */
@Component
@Slf4j
public class LoginRateLimitFilter extends OncePerRequestFilter {

    private static final String LOGIN_PATH = "/api/v1/auth/login";

    /**
     * Bounded to stop a distributed attack turning this map into a memory leak. When the
     * cap is reached the map is cleared, which briefly forgives everyone — acceptable,
     * because the alternative is exhausting the heap and denying service to everybody.
     */
    private static final int MAX_TRACKED_CLIENTS = 10_000;

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;
    private final int capacity;
    private final Duration window;

    public LoginRateLimitFilter(ObjectMapper objectMapper,
                                @Value("${app.rate-limit.login.capacity:10}") int capacity,
                                @Value("${app.rate-limit.login.window:1m}") Duration window) {
        this.objectMapper = objectMapper;
        this.capacity = capacity;
        this.window = window;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !(LOGIN_PATH.equals(request.getRequestURI()) && "POST".equalsIgnoreCase(request.getMethod()));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws IOException, ServletException {

        if (buckets.size() >= MAX_TRACKED_CLIENTS) {
            buckets.clear();
        }

        Bucket bucket = buckets.computeIfAbsent(clientIp(request), key -> newBucket());

        if (bucket.tryConsume(1)) {
            chain.doFilter(request, response);
            return;
        }

        log.warn("Login rate limit exceeded for {}", clientIp(request));
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(),
                Map.of("error", "Too Many Requests", "message", "Too many login attempts"));
    }

    private Bucket newBucket() {
        return Bucket.builder()
                .addLimit(Bandwidth.builder().capacity(capacity).refillGreedy(capacity, window).build())
                .build();
    }

    /**
     * Behind the load balancer the client address is the proxy, so X-Forwarded-For is
     * consulted first. That header is caller-controlled and therefore spoofable — it is
     * trustworthy only because nothing reaches this application except through the
     * load balancer, which overwrites it.
     */
    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
