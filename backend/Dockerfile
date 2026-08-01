# Build stage - same image local/compose.yaml already uses for dev, so this
# introduces no new build-toolchain trust surface.
FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /workspace
COPY pom.xml mvnw ./
COPY .mvn .mvn
COPY src src
# Tests already ran in the build-test CI job before this image is built - running
# them again here would just double the CI minutes for no additional safety.
RUN ./mvnw -B -q clean package -DskipTests

# Runtime stage - slim JRE only, no build toolchain.
FROM eclipse-temurin:17-jre-jammy AS runtime
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
