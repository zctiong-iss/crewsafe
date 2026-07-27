package com.crewsafe.identity;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Properties of the password encoder we depend on elsewhere. Plain unit tests - no Spring
 * context and no database needed.
 */
class PasswordHashingTest {

    private final PasswordEncoder encoder = new BCryptPasswordEncoder();

    @Test
    void hashDoesNotContainThePlaintext() {
        String hash = encoder.encode("correct-horse-battery-staple");

        assertThat(hash).doesNotContain("correct-horse-battery-staple");
        assertThat(hash).startsWith("$2a$");
    }

    @Test
    void matchesTheOriginalPassword() {
        String hash = encoder.encode("correct-horse-battery-staple");

        assertThat(encoder.matches("correct-horse-battery-staple", hash)).isTrue();
        assertThat(encoder.matches("wrong-password", hash)).isFalse();
    }

    @Test
    void samePasswordProducesDifferentHashes() {
        String first = encoder.encode("same-password");
        String second = encoder.encode("same-password");

        // BCrypt salts every hash, so identical passwords must not produce identical
        // hashes - otherwise the table leaks which users share a password.
        assertThat(first).isNotEqualTo(second);
        assertThat(encoder.matches("same-password", first)).isTrue();
        assertThat(encoder.matches("same-password", second)).isTrue();
    }

    @Test
    void hashFitsTheColumn() {
        // password_hash is VARCHAR(120); BCrypt output is a fixed 60 characters.
        assertThat(encoder.encode("any-password")).hasSize(60);
    }
}
