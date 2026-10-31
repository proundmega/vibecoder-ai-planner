# 04_SPECIFICATION.md — Implementation Specification

**Related**: `00_ARCHITECT_CHECKLIST.md`, `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`

**Status**: planned
**Date created**: 2026-09-15
**Author**: AI Assistant

---

## Test-First Requirement

### Step 1: Create Test Stubs

Create/prepare the following test files before production code:

1. **`backend/src/__tests__/ticketService.test.js`** — Already exists, needs signature update (not a new file)
   - No new test stubs needed — existing tests will be updated to match new signature

### Step 2: Create Production Code Files

Modify existing files per `03_ARCHITECT_IMPLEMENTATION.md`.

### Step 3: Fill in Test Stubs

Update existing tests in `ticketService.test.js` to work with new options-object signature.

---

## File Operations (In Order)

### 1. Remove Dead Code (Agent)

**File**: `agent/src/main/java/com/vibecode/agent/service/GitHubService.java`
**Action**: MODIFY — Delete `createPullRequestRetry()` method
**Test stub**: N/A (dead code removal, no test needed)

### 2. Refactor Ticket.update() Signature (Backend)

**File**: `backend/src/models/ticket.js`
**Action**: MODIFY — Change `update()` signature from 8 positional params to `(id, options)`
**Test stub**: N/A (refactor, existing tests will be updated)

### 3. Update TicketService Caller (Backend)

**File**: `backend/src/services/TicketService.js`
**Action**: MODIFY — Pass options object to `Ticket.update()`
**Test stub**: N/A (refactor, existing tests will be updated)

### 4. Update Test Mocks (Backend)

**File**: `backend/src/__tests__/ticketService.test.js`
**Action**: MODIFY — Update test expectations from positional args to options object
**Test stubs**: Update existing test cases:
- `'should pass prUrl to Ticket.update()'` — `capturedArgs[1].prUrl` instead of `capturedArgs[7]`
- `'should pass undefined for prUrl when not provided'` — `capturedArgs[1].prUrl` instead of `capturedArgs[7]`
- `'should pass null for prUrl when explicitly null'` — `capturedArgs[1].prUrl` instead of `capturedArgs[7]`
- `'should handle prUrl alongside other fields'` — `capturedArgs[1].status` and `capturedArgs[1].prUrl` instead of `capturedArgs[3]` and `capturedArgs[7]`

### 5. Pin Git Version (Agent Dockerfile)

**File**: `agent/Dockerfile`
**Action**: MODIFY — Replace `RUN apk add --no-cache git` with version-pinned version
**Test stub**: N/A (Docker build verification)

---

## Verification Steps

1. `cd backend && npm test` — all 1343 tests pass
2. `cd agent && mvn package -DskipTests -B` — BUILD SUCCESS
3. `cd agent && docker build -t test-agent .` — Dockerfile builds successfully
4. `grep -r createPullRequestRetry agent/` — returns nothing

---

## Out of Scope

- Other Dockerfile improvements (node version pin, etc.)
- Refactoring other methods with many positional parameters
- Adding new dependencies or tools
- Integration tests for these changes (they are internal cleanups)

---

*This specification lists exact file paths and changes for the implementing model.*
