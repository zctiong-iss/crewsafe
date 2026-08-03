# Build stage - same digest-pinned image local/compose.yaml already uses for dev
# (Temurin jdk-21.0.11+10), so this introduces no new build-toolchain trust surface.
# Re-pin deliberately, together with local/compose.yaml, when moving to a newer JDK.
FROM maven:3.9.16-eclipse-temurin-21@sha256:2b4496088e7b80ae10a8c9f74e574ea21380325a006ec684532ad6bad5bc7273 AS build
WORKDIR /workspace
COPY pom.xml mvnw ./
COPY .mvn .mvn
COPY src src
# Tests already ran in the build-test CI job before this image is built - running
# them again here would just double the CI minutes for no additional safety.
RUN ./mvnw -B -q clean package -DskipTests

# Runtime stage - slim JRE only, no build toolchain. Digest-pinned for the same
# reason as the build stage: a floating tag lets the bundled JRE change on any
# pull, with no diff to review.
FROM eclipse-temurin:21-jre-jammy@sha256:d63bd8d9b171999cbed8576f2c76e874dd4856791a358536e5c4d407e77edc13 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 1000 --create-home crewsafe
WORKDIR /app
COPY --from=build /workspace/target/crewsafe-backend-*.jar ./app.jar
RUN chown crewsafe:crewsafe app.jar
USER crewsafe
EXPOSE 8080
# /actuator/health is permitAll() in SecurityConfig, so this succeeds without credentials.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]
