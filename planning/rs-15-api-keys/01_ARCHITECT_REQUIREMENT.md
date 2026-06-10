# 01_ARCHITECT_REQUIREMENT.md — Secure API Key Storage

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Requirement

Project admins can add, view, and edit API keys (Anthropic, OpenAI, GitHub PATs) stored encrypted in the database. Only project_admin can manage keys. Keys are used by agents assigned to the project.

---

## Scope

- Per-account key management (project_admin only)
- AES-256-GCM encryption in DB
- Key masking in API responses (show last 4 chars only)
- Key rotation without downtime
- Shared encryption utility across all providers

---

## Testing Checklist (MANDATORY)

- [ ] **Happy path**: project_admin adds key → agent uses it → key works
- [ ] **Encryption**: Key stored encrypted, retrieved decrypted
- [ ] **Authorization**: Non-admin cannot view/edit keys
- [ ] **Error handling**: Invalid key format, duplicate keys, missing encryption key
- [ ] **Edge cases**: Key rotation, key deletion, empty key list
- [ ] **Masking**: API responses show masked keys (••••1234)

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors
- Backend integration test: encrypt/decrypt roundtrip, key CRUD

---

## Anti-Patterns to Avoid

- ❌ Storing keys in plaintext — always encrypt
- ❌ Returning full keys in API responses — mask them
- ❌ Testing implementation details — test behavior (key encrypted, masked in response)
- ❌ Merging code without tests

---

## Code Change Requirements

1. Write unit tests before or alongside the implementation
2. Write integration tests covering the full request lifecycle
3. Run `npm test` — must pass
4. Pass `npm run lint` with zero errors
