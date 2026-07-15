FROM maven:3.9-eclipse-temurin-17-alpine AS build

WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src/ ./src/
RUN mvn package -DskipTests -B

FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# Copy the shaded JAR from the build stage (maven-shade-plugin creates artifactId-version.jar)
COPY --from=build /app/target/agent-*.jar agent.jar

# Create a non-root user
RUN addgroup -S agent && adduser -S agent -G agent
USER agent

# Health check — agent is a CLI app, no HTTP server
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep -f "java -jar agent.jar" || exit 1

ENTRYPOINT ["java", "-jar", "agent.jar"]
