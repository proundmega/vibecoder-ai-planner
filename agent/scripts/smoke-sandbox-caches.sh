#!/usr/bin/env bash
#
# Real-Docker package-manager/cache smoke for fg-39 FR4 / D11.
#
# Runs each package manager twice against the same cache directory:
#   1. populate the cache (npm and Go use local, network-free fixtures;
#      Maven downloads its plugins/dependencies once on the default network)
#   2. remove the fixture/network access and prove the second run works from
#      the persisted cache alone.
#
# The mount targets and environment match CachePlan's runtime contract:
#   npm    /cache/npm       NPM_CONFIG_CACHE
#   maven  /cache/maven     MAVEN_OPTS=-Dmaven.repo.local=/cache/maven
#   go     /cache/go/mod    GOMODCACHE, /cache/go/build GOCACHE
#
# This is an operator smoke test, not part of CI. It intentionally uses the
# host Docker daemon and public Maven Central for the first Maven run; the
# reuse run uses --network none. Requires bash, Docker and Python 3 (for the
# local Go module zip).
#
# Usage:
#   scripts/smoke-sandbox-caches.sh [--build]
#
# Environment:
#   SANDBOX_STACK_TAG       image tag (default: latest)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT/sandbox-stacks.Dockerfile"
TAG="${SANDBOX_STACK_TAG:-latest}"
NODE_IMAGE="vibecode-sandbox-node:${TAG}"
JAVA_IMAGE="vibecode-sandbox-java:${TAG}"
GO_IMAGE="vibecode-sandbox-go:${TAG}"
BUILD=0

if [[ "${1:-}" == "--build" ]]; then
    BUILD=1
elif [[ $# -gt 0 ]]; then
    echo "error: unknown argument: $1" >&2
    exit 2
fi

if [[ "$BUILD" == "1" ]]; then
    for target in node java go; do
        echo "building vibecode-sandbox-${target}:${TAG}"
        docker build \
            --target "$target" \
            --file "$DOCKERFILE" \
            --tag "vibecode-sandbox-${target}:${TAG}" \
            "$ROOT" >/dev/null
    done
fi

for image in "$NODE_IMAGE" "$JAVA_IMAGE" "$GO_IMAGE"; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
        echo "error: ${image} is not present; run with --build" >&2
        exit 1
    fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vibecode-cache-smoke.XXXXXX")"
CACHE="$WORK/cache"
mkdir -p "$CACHE/npm" "$CACHE/maven" "$CACHE/go/mod" "$CACHE/go/build"

cleanup() {
    if [[ -d "$WORK" ]]; then
        # Go's module cache is read-only; remove it as root in a container.
        docker run --rm --user 0:0 -v "$WORK:/cleanup" --entrypoint sh \
            "$NODE_IMAGE" -c 'rm -rf /cleanup/* /cleanup/.[!.]*' \
            >/dev/null 2>&1 || true
        chmod -R u+rwX "$WORK" 2>/dev/null || true
        rm -rf "$WORK"
    fi
}
trap cleanup EXIT

run_node() {
    local network="$1" workdir="$2"
    shift 2
    docker run --rm --network "$network" --user 1000:1000 \
        -v "$WORK:/work" \
        -v "$CACHE/npm:/cache/npm" \
        -e NPM_CONFIG_CACHE=/cache/npm \
        -w "/work/${workdir}" "$NODE_IMAGE" "$@"
}

run_maven() {
    local network="$1" workdir="$2"
    shift 2
    docker run --rm --network "$network" --user 1000:1000 \
        -v "$WORK:/work" \
        -v "$CACHE/maven:/cache/maven" \
        -e MAVEN_OPTS=-Dmaven.repo.local=/cache/maven \
        -w "/work/${workdir}" "$JAVA_IMAGE" "$@"
}

run_go() {
    local network="$1" proxy="$2"
    shift 2
    docker run --rm --network "$network" --user 1000:1000 \
        -v "$WORK:/work" \
        -v "$CACHE/go/mod:/cache/go/mod" \
        -v "$CACHE/go/build:/cache/go/build" \
        -e GOMODCACHE=/cache/go/mod \
        -e GOCACHE=/cache/go/build \
        -e GOPROXY="$proxy" \
        -e GOSUMDB=off \
        -w /work/go/app "$GO_IMAGE" "$@"
}

echo "smoke root: $WORK"

# --- npm: local tarball, then offline install from the cache -----------------
mkdir -p "$WORK/npm/dep" "$WORK/npm/app"
cat > "$WORK/npm/dep/package.json" <<'EOF'
{"name":"smoke-dep","version":"1.0.0","main":"index.js"}
EOF
printf 'module.exports = () => 42;\n' > "$WORK/npm/dep/index.js"
printf 'const dep = require("smoke-dep");\nif (dep() !== 42) throw new Error("bad cache");\nconsole.log("npm cache ok");\n' \
    > "$WORK/npm/app/index.js"
chmod -R a+rwX "$WORK/npm"

echo "packing the local npm fixture"
run_node none npm/dep npm pack --silent >/dev/null
cat > "$WORK/npm/app/package.json" <<'EOF'
{"name":"smoke-app","version":"1.0.0","dependencies":{"smoke-dep":"file:../dep/smoke-dep-1.0.0.tgz"}}
EOF
chmod -R a+rwX "$WORK/npm"
echo "npm: first install"
run_node none npm/app npm install --no-audit --no-fund >/dev/null
rm -rf "$WORK/npm/app/node_modules" "$WORK/npm/dep"
echo "npm: offline install from the persisted cache"
run_node none npm/app sh -c 'npm install --offline --no-audit --no-fund && node index.js'
[[ -d "$CACHE/npm/_cacache" ]] || { echo "error: npm cache was not populated" >&2; exit 1; }

# --- Maven: populate once with network, then run offline --------------------
mkdir -p "$WORK/maven/src/main/java/x" "$WORK/maven/src/test/java/x"
cat > "$WORK/maven/pom.xml" <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>x</groupId>
  <artifactId>smoke</artifactId>
  <version>1.0</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>
EOF
printf 'package x;\n\npublic class App {\n    public static int add(int a, int b) { return a + b; }\n}\n' \
    > "$WORK/maven/src/main/java/x/App.java"
printf 'package x;\n\nimport org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.assertEquals;\n\nclass AppTest {\n    @Test\n    void adds() { assertEquals(3, App.add(1, 2)); }\n}\n' \
    > "$WORK/maven/src/test/java/x/AppTest.java"
chmod -R a+rwX "$WORK/maven"

echo "maven: first test run (network allowed to populate the local repository)"
run_maven bridge maven mvn -q -B test
rm -rf "$WORK/maven/target"
echo "maven: offline test run from the persisted cache"
run_maven none maven mvn -q -B -o test
grep -q 'Tests run' "$WORK/maven/target/surefire-reports/"*.txt \
    || { echo "error: Maven tests did not run" >&2; exit 1; }
[[ -n "$(find "$CACHE/maven" -mindepth 1 -print -quit)" ]] \
    || { echo "error: Maven cache was not populated" >&2; exit 1; }

# --- Go: local file proxy, then offline module/build cache reuse -------------
mkdir -p \
    "$WORK/go/proxy/example.com/dep/@v" \
    "$WORK/go/dep/example.com/dep@v1.0.0" \
    "$WORK/go/app"
printf 'module example.com/dep\n\ngo 1.22\n' \
    > "$WORK/go/dep/example.com/dep@v1.0.0/go.mod"
printf 'package dep\n\nfunc Answer() int { return 42 }\n' \
    > "$WORK/go/dep/example.com/dep@v1.0.0/dep.go"
python3 - "$WORK/go" <<'PY'
import pathlib
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(root / "proxy/example.com/dep/@v/v1.0.0.zip", "w") as archive:
    base = root / "dep"
    for path in base.rglob("*"):
        if path.is_file():
            archive.write(path, path.relative_to(base))
PY
printf '{"Version":"v1.0.0","Time":"2024-01-01T00:00:00Z"}\n' \
    > "$WORK/go/proxy/example.com/dep/@v/v1.0.0.info"
cp "$WORK/go/dep/example.com/dep@v1.0.0/go.mod" \
    "$WORK/go/proxy/example.com/dep/@v/v1.0.0.mod"
cat > "$WORK/go/app/go.mod" <<'EOF'
module example.com/app

go 1.22

require example.com/dep v1.0.0
EOF
printf 'package app\n\nimport (\n\t"testing"\n\n\t"example.com/dep"\n)\n\nfunc TestAnswer(t *testing.T) {\n\tif dep.Answer() != 42 { t.Fatal("bad cache") }\n}\n' \
    > "$WORK/go/app/app_test.go"
chmod -R a+rwX "$WORK/go"

echo "go: first test run from the local file proxy"
run_go none file:///work/go/proxy sh -c 'go mod tidy && go test ./...'
rm -rf "$WORK/go/proxy"
echo "go: offline test run from the module/build cache"
run_go none off go test ./...
[[ -n "$(find "$CACHE/go/mod" -mindepth 1 -print -quit)" ]] \
    || { echo "error: Go module cache was not populated" >&2; exit 1; }
[[ -n "$(find "$CACHE/go/build" -mindepth 1 -print -quit)" ]] \
    || { echo "error: Go build cache was not populated" >&2; exit 1; }

echo "all sandbox cache smoke tests passed"
