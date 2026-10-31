# 00_ARCHITECT_CHECKLIST.md - Repository Onboarding and Environment Profiles (fg-39)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-34 sandbox
**Related code:** `VerificationRunner`, `WorkspaceManager`, `agent/Dockerfile`, project settings

## Why this ticket exists

The harness currently assumes the cloned repo can install and test itself. Real projects need pinned toolchains, dependency caches, databases/Redis, monorepo commands, test data and known flaky-test handling. Most agent failures will be environment failures, not coding failures.

## Checklist

- [ ] Define the repo profile schema
- [ ] Add onboarding detection and a project settings UI/API
- [ ] Define per-stack sandbox images and cached dependencies
- [ ] Support service dependencies (Postgres, Redis, etc.)
- [ ] Define setup/verify/test-data commands and timeouts
- [ ] Inject non-secret env vars safely
- [ ] Handle flaky tests and known failures
- [ ] Add profile validation/dry-run
- [ ] Test Node, Python, Java and monorepo profiles
