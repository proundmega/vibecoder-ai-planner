FROM maven:3.9-eclipse-temurin-17-alpine AS build

WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src/ ./src/
RUN mvn package -DskipTests -B

FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY --from=build /app/target/agent-1.0.0.jar agent.jar

ENV BACKEND_URL=http://backend:3001
ENV REPO_CLONE_DIR=/repos
ENV API_KEY=changeme

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "agent.jar"]
