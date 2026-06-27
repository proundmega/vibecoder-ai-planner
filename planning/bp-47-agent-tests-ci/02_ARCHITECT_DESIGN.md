# bp-47: Add Java Agent Tests to CI Pipeline — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: CI / Agent

## Current State

`agent/` contains:
- `pom.xml` with JUnit 5 (v5.10.x), Mockito, and Maven Surefire Plugin
- Test sources in `src/test/java/com/vibecode/agent/`
- Existing test classes (e.g., `TicketProcessorTest.java`, `GitHubServiceTest.java`)

No CI job references the agent directory.

## Proposed Solution

### New Job: agent

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

### Job Properties

- **No dependencies** (`needs: []`) — runs in parallel with backend/frontend
- **Cache Maven dependencies** via `cache: maven` in setup-java
- **No services** (no PostgreSQL, no Docker)
- **Fast** — should complete in < 2 minutes with cached deps

### Surefire Configuration (verify only)

Check `agent/pom.xml` for:
```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <version>3.2.3</version>
</plugin>
```

If missing, add it. If present, no change needed.

## Alternatives Considered

- **Step in backend job**: Rejected — would require JDK installation in a Node-based job
- **Docker-based agent test**: Rejected — real agent tests run without Docker

## File-Level Impact Matrix

| File | Action | Details |
|------|--------|---------|
| `.github/workflows/ci.yml` | MODIFY | Add `agent` job |
| `agent/pom.xml` | VERIFY | Ensure surefire plugin present (no change expected) |
