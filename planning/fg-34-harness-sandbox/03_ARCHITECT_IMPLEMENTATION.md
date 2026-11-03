# 03 — Implementation (fg-34)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Choose the sandbox runtime (Docker sibling, Podman, rootless container, microVM)
- [ ] Define CPU/memory/PID/disk/time limits per run
- [ ] Deny host Docker socket, privileged mode and host mounts
- [ ] Define the network egress policy (model endpoints + package registries only)
- [ ] Define secretless execution and a safe way to inject non-secret test config
- [ ] Harden prompt-injection handling for repo docs, issues and PR text
- [ ] Add malicious-repo and escape-attempt tests
- [ ] Add image scanning, SBOM and signed base images
- [ ] Define the fallback for local Windows development
- [ ] Roll out behind a flag before making it the default

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-30

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | | | | |
| FR2 | | | | |
| FR3 | | | | |
| FR4 | | | | |
| FR5 | | | | |
| FR6 | | | | |
| FR7 | | | | |
| FR8 | | | | |
| FR9 | | | | |
| FR10 | | | | |
| FR11 | | | | |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
