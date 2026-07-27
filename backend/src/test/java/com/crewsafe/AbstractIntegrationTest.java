package com.crewsafe;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base class for tests that need a database.
 *
 * Runs against real PostgreSQL 16 rather than H2 so that Flyway migrations, UUID columns,
 * check constraints and {@code TIMESTAMPTZ} behave exactly as they will in staging. H2 in
 * PostgreSQL-compatibility mode diverges on all four, which hides migration bugs until
 * after deployment.
 *
 * The container uses the singleton pattern — started once in a static initialiser and
 * reused by every subclass for the lifetime of the JVM. A {@code @Container}-managed
 * static field would be stopped and restarted for each test class, costing several
 * seconds per class.
 */
@SpringBootTest
public abstract class AbstractIntegrationTest {

    static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16");
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void testProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);

        // Test-only signing secret. Set here rather than in a test application.yml, which
        // would shadow the main one and take the datasource and Flyway config with it.
        registry.add("app.jwt.secret", () -> "test-only-signing-secret-at-least-32-bytes-long");

        // Note: do NOT set app.rate-limit.login.capacity here. @DynamicPropertySource
        // outranks a subclass's @TestPropertySource, so a value set here cannot be
        // overridden by a test that needs a different one. Classes that log in
        // repeatedly raise the limit themselves.
    }
}
