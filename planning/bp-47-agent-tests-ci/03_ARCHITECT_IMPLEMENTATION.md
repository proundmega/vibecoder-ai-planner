# bp-47: Add Java Agent Tests to CI Pipeline — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Small
**Scope**: CI / Agent

## Purpose
Run Java agent unit tests in CI so agent compilation and test failures are caught automatically.

## Implementation Order

1. **Verify `agent/pom.xml`** — check for surefire plugin
2. **Add `agent` job to `.github/workflows/ci.yml`**
3. **Push and verify** in GitHub Actions

## Per-File Action Plan

### `.github/workflows/ci.yml` (MODIFY)

Add after the `frontend` job (or anywhere at the top level):

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

### `agent/pom.xml` (VERIFY)

Check for existing surefire configuration. Expected content:
```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <version>3.2.3</version>
</plugin>
```

If missing, add within `<build><plugins>` section.

Also verify JUnit dependency:
```xml
<dependency>
  <groupId>org.junit.jupiter</groupId>
  <artifactId>junit-jupiter</artifactId>
  <version>5.10.2</version>
  <scope>test</scope>
</dependency>
```

## Migration Plan
No database changes. No API changes.

## Test Plan
1. Push to GitHub, verify agent job appears in CI pipeline
2. Verify agent job runs `mvn test`, compiles, and tests pass
3. Verify agent job completes in < 3 minutes
4. Verify other jobs (backend, frontend) are unaffected
5. Temporarily break a test, verify agent job fails (then revert)

## Rollback Steps
1. Remove `agent` job from `ci.yml`
2. No other changes to revert
