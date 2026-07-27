package com.crewsafe.identity.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Authenticates requests from an {@code Authorization: Bearer} header.
 *
 * <p><strong>Bearer tokens only — no cookies, no session.</strong> The reference project
 * this is adapted from falls through to a session cookie when no Bearer header is present,
 * because it also serves server-rendered pages. CrewSafe serves only JSON to a React web
 * app and a React Native app, so there is no session to fall back to and none is created.
 *
 * <p>Two distinct cases, deliberately handled differently:
 * <ul>
 *   <li><strong>No Bearer header</strong> — continue the chain unauthenticated. Endpoints
 *       such as login and health are {@code permitAll}; anything protected is rejected
 *       later by the entry point. Returning 401 here would break those.</li>
 *   <li><strong>Bearer header present but invalid</strong> — reject immediately with 401.
 *       Someone made an explicit, failed authentication attempt; continuing would produce a
 *       misleading error further down.</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String HEADER = "Authorization";
    private static final String PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final CrewSafeUserDetailsService userDetailsService;
    private final ObjectMapper objectMapper;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws IOException, ServletException {

        String header = request.getHeader(HEADER);
        if (header == null || !header.startsWith(PREFIX)) {
            chain.doFilter(request, response);
            return;
        }

        String token = header.substring(PREFIX.length());

        // TokenType.ACCESS is what stops a refresh token being replayed here.
        Optional<UUID> userId = jwtService.extractUserId(token, TokenType.ACCESS);
        if (userId.isEmpty()) {
            unauthorized(response);
            return;
        }

        CrewSafeUserPrincipal principal;
        try {
            principal = userDetailsService.loadUserById(userId.get());
        } catch (UsernameNotFoundException e) {
            // Valid signature, but the account has since been deleted.
            unauthorized(response);
            return;
        }

        if (!principal.isEnabled()) {
            // Valid token, deactivated account. Checked per request rather than trusted
            // from the token, so deactivation takes effect immediately.
            unauthorized(response);
            return;
        }

        var authentication = new UsernamePasswordAuthenticationToken(
                principal, null, principal.getAuthorities());
        authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
        SecurityContextHolder.getContext().setAuthentication(authentication);

        chain.doFilter(request, response);
    }

    private void unauthorized(HttpServletResponse response) throws IOException {
        SecurityContextHolder.clearContext();
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        // Uniform message: never reveal whether the token was expired, forged or of the
        // wrong type.
        objectMapper.writeValue(response.getWriter(),
                Map.of("error", "Unauthorized", "message", "Authentication failed"));
    }
}
