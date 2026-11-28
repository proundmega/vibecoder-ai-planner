# Base images are pinned by digest (fg-34 FR9). Update the digest deliberately
# when upgrading; run `agent/scripts/sandbox-image-security.sh --check-pins`.
FROM maven:3.9-eclipse-temurin-17-alpine@sha256:b7c8d7298dbabbe750441736cd99a1d120a58083d5af8d2bd75a1624cfdd8f3a AS build

WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src/ ./src/
RUN mvn package -DskipTests -B

# Node runtime for the OpenCode harness. A glibc image is required: the
# workspace bridge needs SecureDirectoryStream, which the Alpine/musl JRE does
# not provide. The supervisor and the harness share one container.
FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530

ARG OPENCODE_VERSION=1.19.5

RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-17-jre-headless git openssh-client ripgrep bash curl jq python3 make \
      libstdc++6 util-linux ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

COPY --from=docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c /usr/local/bin/docker /usr/local/bin/docker
RUN npm install -g opencode-ai@${OPENCODE_VERSION} \
    && chmod -R a+rX /usr/local/lib/node_modules

WORKDIR /app

# Copy the shaded JAR from the build stage (maven-shade-plugin creates artifactId-version.jar)
COPY --from=build /app/target/agent-*.jar agent.jar

# Create the same non-root identity used by the previous image (100:101) so
# an existing credentials volume remains readable.
RUN groupadd --gid 101 agent \
    && useradd --uid 100 --gid 101 --home-dir /home/agent --create-home --shell /bin/bash agent \
    && mkdir -p /repos /tmp/opencode /home/agent /credentials \
    && chown -R agent:agent /repos /tmp/opencode /home/agent /credentials
USER agent

ENV HOME=/home/agent
ENV REPO_CLONE_DIR=/repos
ENV HARNESS_BIN=opencode

# Health check — agent is a CLI app, no HTTP server
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep -f "java -jar agent.jar" || exit 1

ENTRYPOINT ["java", "-jar", "agent.jar"]
