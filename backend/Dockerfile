# Build stage source tag: maven:3.9.16-eclipse-temurin-21
# Same digest-pinned image local/compose.yaml already uses for dev
# (Temurin JDK 21), so this introduces no new build-toolchain trust surface.
# Re-pin deliberately, together with local/compose.yaml, when moving to a newer JDK.
FROM maven@sha256:c07f7ccfb8ca6c9fa29ee523f00afa7d2ca6132c92f8652c4aebb5ee3491f502 AS build
WORKDIR /workspace
COPY pom.xml mvnw ./
COPY .mvn .mvn
COPY src src
# Tests already ran in the build-test CI job before this image is built - running
# them again here would just double the CI minutes for no additional safety.
RUN ./mvnw -B -q clean package -DskipTests

# Runtime stage source tag: eclipse-temurin:21-jre-jammy
# Slim JRE only, no build toolchain. Digest-pinned for the same
# reason as the build stage: a floating tag lets the bundled JRE change on any
# pull, with no diff to review.
FROM eclipse-temurin@sha256:8864e3ba0704b8cbd0b74a0959e6ca285eaaa7c899fa0777757cde8a71e62e2e AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 1000 --create-home crewsafe
WORKDIR /app
COPY --from=build /workspace/target/crewsafe-backend-*.jar ./app.jar
RUN chown crewsafe:crewsafe app.jar
USER crewsafe
EXPOSE 8080
# /actuator/health is permitAll() in SecurityConfig, so this succeeds without credentials.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
