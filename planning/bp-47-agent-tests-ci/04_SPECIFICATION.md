# bp-47: Add Java Agent Tests to CI Pipeline — Spec

**Target model**: 7B–14B (YAML, XML)
**Date**: 2026-06-27

## File Operations

### MODIFY: `.github/workflows/ci.yml`

**Add new job** (can go after `frontend` job, at root level of jobs):

```yaml
  agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: maven
      - name: Run agent tests
        run: mvn test
        working-directory: agent
```

### VERIFY: `agent/pom.xml`

Check that these exist (no change needed if already present):

**Surefire plugin** in `<build><plugins>`:
```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <version>3.2.3</version>
</plugin>
```

**JUnit 5 dependency** in `<dependencies>`:
```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <version>5.10.2</version>
  <scope>test</scope>
</dependency>
```

## Test Expectations

```
✓ Agent job appears in CI workflow alongside backend, frontend
✓ mvn test compiles and runs agent unit tests
✓ Agent job completes in < 3 minutes
✓ CI fails when agent test fails (red X)
✓ CI passes when agent test passes (green check)
✓ Maven dependencies cached (second run uses cache)
```

## Edge Cases

1. **Maven cache miss**: First run fetches all dependencies (~30s overhead), subsequent runs should use cache
2. **No tests found**: Surefire fails if no test classes match `**/Test*.java` or `**/*Test.java` — verify glob matches agent test files
3. **Java 17 compatibility**: All agent code compiles with Java 17 (target in pom.xml should be 17)
4. **Parallel with other jobs**: Agent job has no `needs` — runs immediately alongside backend and frontend
