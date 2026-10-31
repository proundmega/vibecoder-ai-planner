FROM maven:3.9-eclipse-temurin-17-alpine AS build

WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src/ ./src/
RUN mvn package -DskipTests -B

# Node runtime for the OpenCode harness. Copied into the JRE image so the
# supervisor and the harness share one container.
FROM node:24-alpine AS node

FROM eclipse-temurin:17-jre-alpine

ARG OPENCODE_VERSION=1.19.5

RUN apk add --no-cache git ripgrep bash curl jq python3 make libstdc++

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && npm install -g opencode-ai@${OPENCODE_VERSION} \
    && chmod -R a+rX /usr/local/lib/node_modules

WORKDIR /app

# Copy the shaded JAR from the build stage (maven-shade-plugin creates artifactId-version.jar)
COPY --from=build /app/target/agent-*.jar agent.jar

# Create a non-root user with a writable home and workspace directories
RUN addgroup -S agent \
    && adduser -S -G agent -h /home/agent agent \
    && mkdir -p /repos /tmp/opencode /home/agent \
    && chown -R agent:agent /repos /tmp/opencode /home/agent
USER agent

ENV HOME=/home/agent
ENV REPO_CLONE_DIR=/repos
ENV HARNESS_BIN=opencode

# Health check — agent is a CLI app, no HTTP server
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep -f "java -jar agent.jar" || exit 1

ENTRYPOINT ["java", "-jar", "agent.jar"]
