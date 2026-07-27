package com.crewsafe.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Password hashing.
 *
 * BCrypt with the default strength of 10. It is deliberately slow, salts each hash
 * automatically, and stores the salt and cost factor inside the hash string — so raising
 * the cost later does not invalidate existing hashes.
 *
 * Declared here rather than in the security configuration because hashing is needed before
 * any filter chain exists (the demo seeder uses it at startup).
 */
@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
