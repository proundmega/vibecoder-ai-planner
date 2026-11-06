# Base images are pinned by digest (fg-34 FR9). Update the digest deliberately
# when upgrading; run `agent/scripts/sandbox-image-security.sh --check-pins`.
FROM maven:3.9-eclipse-temurin-17-alpine@sha256:b7c8d7298dbabbe750441736cd99a1d120a58083d5af8d2bd75a1624cfdd8f3a AS build

WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src/ ./src/
RUN mvn package -DskipTests -B

# Node runtime for the OpenCode harness. Copied into the JRE image so the
# supervisor and the harness share one container.
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS node

FROM eclipse-temurin:17-jre-alpine@sha256:e2ba4e947bd5e236a9866fbdda03e4936036cb9e9d16ea0d84d103d6634a5c21

ARG OPENCODE_VERSION=1.19.5

RUN apk add --no-cache git ripgrep bash curl jq python3 make libstdc++ util-linux docker-cli

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
