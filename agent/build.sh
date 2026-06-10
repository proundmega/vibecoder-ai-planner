#!/bin/bash
set -e

echo "=== Vibecode AI Agent Build Script ==="
echo ""

# Check for Java
if ! command -v java &> /dev/null; then
    echo "Java not found. Installing OpenJDK 17..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y openjdk-17-jdk-headless
    elif command -v yum &> /dev/null; then
        sudo yum install -y java-17-openjdk-headless
    elif command -v brew &> /dev/null; then
        brew install openjdk@17
    else
        echo "Error: Could not install Java. Please install OpenJDK 17 manually."
        exit 1
    fi
fi

# Check for Maven
if ! command -v mvn &> /dev/null; then
    echo "Maven not found. Installing Maven..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y maven
    elif command -v yum &> /dev/null; then
        sudo yum install -y maven
    elif command -v brew &> /dev/null; then
        brew install maven
    else
        echo "Error: Could not install Maven. Please install Maven 3.8+ manually."
        exit 1
    fi
fi

echo ""
echo "=== Building agent ==="
cd "$(dirname "$0")"
mvn clean package -DskipTests -B

echo ""
echo "=== Running tests ==="
mvn test -B

echo ""
echo "=== Build complete ==="
echo "JAR: target/agent-1.0.0.jar"
echo ""
echo "To run:"
echo "  AGENT_API_KEY=xxx BACKEND_URL=http://localhost:3001 PROJECT_ID=1 REPO_OWNER=myorg REPO_NAME=myrepo java -jar target/agent-1.0.0.jar"
echo ""
echo "Or with Docker:"
echo "  docker compose up --build"
