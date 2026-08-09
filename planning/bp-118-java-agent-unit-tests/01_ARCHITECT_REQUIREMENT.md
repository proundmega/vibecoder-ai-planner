# bp-118: Java Agent Unit Tests

## Ticket Information
- **ID**: bp-118
- **Priority**: P3 (testing coverage)
- **Type**: Test Backfill
- **Scope**: Java agent (agent/)

## Problem Statement

The Java agent has only 27 tests across 3 test files, covering ~25-30% of the codebase. The most critical classes (`TicketProcessor`, `ApiService`, AI providers, `GitHubService`) have zero tests. This is a significant risk given the agent handles ticket processing, AI calls, and GitHub operations.

### Current Test Coverage

| Class | Test File | Tests | Status |
|-------|-----------|-------|--------|
| `Ticket.java` | `TicketTest.java` | 6 | ✅ Good |
| `AgentConfig.java` | `AgentConfigTest.java` | 4 | ⚠️ Partial (only getGitHubBranchName) |
| `WorkspaceManager.java` | `WorkspaceManagerTest.java` | 17 | ✅ Good |
| `TicketProcessor.java` | — | 0 | ❌ Missing (457 lines) |
| `ApiService.java` | — | 0 | ❌ Missing (270 lines) |
| `AgentApp.java` | — | 0 | ❌ Missing (220 lines) |
| `GitHubService.java` | — | 0 | ❌ Missing (186 lines) |
| `OpenAiProvider.java` | — | 0 | ❌ Missing (101 lines) |
| `ClaudeProvider.java` | — | 0 | ❌ Missing (97 lines) |
| `OpenAiCompatibleProvider.java` | — | 0 | ❌ Missing (128 lines) |

## Solution

Add unit tests for the most testable classes (pure functions, no network dependencies):

### HIGH PRIORITY (pure functions, no mocking needed)

1. **TicketProcessor.java** — Add tests for:
   - `parseFileOperationsWithStatus()` — JSON parsing with markdown code block stripping
   - `inferPlanningStage()` — String matching logic
   - `extractFileKeys()` — Parsing `=== key ===` format
   - `buildPrBody()` — PR body string building

2. **AgentConfig.java** — Add tests for:
   - `requireEnv()` throws `IllegalStateException` when env var missing
   - `getIntEnv()` / `getLongEnv()` invalid number parsing (fallback to default)
   - `getApiUrl()` with trailing vs non-trailing slash
   - `getEnv()` with blank string values

### MEDIUM PRIORITY (need mocked OkHttp)

3. **OpenAiProvider.java** — Tests for:
   - Token tracking (`tokensIn`, `tokensOut`)
   - `getType()` returns `"openai"`
   - Error response parsing

4. **ClaudeProvider.java** — Tests for:
   - Anthropic response shape parsing
   - `getType()` returns `"claude"`

5. **OpenAiCompatibleProvider.java** — Tests for:
   - Fallback parsing for `text` field
   - Optional API key handling

## Implementation Plan

### 1. TicketProcessorTest.java

Test the pure parsing methods in isolation:
```java
@Test
void parseFileOperationsWithStatus_validJson() { ... }
@Test
void parseFileOperationsWithStatus_markdownCodeBlock() { ... }
@Test
void parseFileOperationsWithStatus_invalidAction() { ... }
@Test
void extractFileKeys_multipleKeys() { ... }
@Test
void inferPlanningStage_implementation() { ... }
```

### 2. AgentConfigTest.java — Extend

Add tests for env var edge cases:
```java
@Test
void requireEnv_missingThrows() { ... }
@Test
void getIntEnv_invalidReturnsDefault() { ... }
@Test
void getApiUrl_trailingSlashNormalized() { ... }
```

### 3. ProviderTests.java

Test AI provider parsing with mocked OkHttp responses:
```java
@Test
void openAiProvider_tokenTracking() { ... }
@Test
void claudeProvider_anthropicResponseShape() { ... }
@Test
void compatibleProvider_fallbackParsing() { ... }
```

## Files to Create

| File | Purpose |
|------|---------|
| `agent/src/test/java/com/vibecode/agent/service/TicketProcessorTest.java` | ~400 lines, 15+ tests |
| `agent/src/test/java/com/vibecode/agent/service/ProviderTest.java` | ~250 lines, 10+ tests |

## Files to Extend

| File | Changes |
|------|---------|
| `agent/src/test/java/com/vibecode/agent/config/AgentConfigTest.java` | Add 5+ new tests |

## Testing

- `mvn test` — all existing + new tests pass
- Target: 70+ tests total (from current 27)

## Out of Scope

- Integration tests (require backend + AI provider)
- `AgentApp.java` tests (too integration-heavy)
- `ApiService.java` tests (requires mocked OkHttp for all endpoints)
- `GitHubService.java` tests (covered by bp-114)

## Deferred Improvements Found

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-114 | GitHubService unit tests | Testing | (covered by bp-114) |
| 2 | bp-113 | Route-level permission guards | Security | bp-115-route-permission-guards |
| 3 | bp-113 | Planning file usage UI | UX | bp-116-planning-file-usage-ui |
| 4 | bp-113 | Route mount audit script | Developer experience | bp-117-route-mount-audit |
| 5 | bp-99 | Runtime provider config hot reload | Feature | bp-119-provider-config-hot-reload |
