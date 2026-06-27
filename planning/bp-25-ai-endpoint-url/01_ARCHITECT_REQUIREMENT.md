# bp-25: Add AI_ENDPOINT_URL + OpenAI-Compatible Provider Adapter

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Agent
**Priority**: P0
**Effort**: Medium

## Problem Statement

The Java agent hardcodes two AI providers (Claude, OpenAI) via `AgentConfig.java`. API keys are env vars. Endpoint URLs are hardcoded in each provider class. There is no way to plug in a local model server (Ollama, vLLM, llama.cpp) without modifying Java source. This blocks running agents against self-hosted models.

## Scope

- **In scope**: OpenAI-compatible adapter class, `AI_ENDPOINT_URL` env var, fallback logic to use endpoint URL when set
- **Out of scope**: Per-project provider config (bp-29), agent credential store integration, per-ticket model routing

## Acceptance Criteria

- [ ] New env var `AI_ENDPOINT_URL` overrides built-in providers when set
- [ ] New `OpenAiCompatibleProvider` class speaks `/v1/chat/completions` format (OpenAI-compatible)
- [ ] Agent uses the endpoint URL when provided, falls back to existing Claude/OpenAI otherwise
- [ ] Local models can be reached via `http://host.docker.internal:11434/v1` (Ollama)
- [ ] API key is optional (null for local models that don't require auth)

## Known Unknowns

- **Model response format**: Different local servers return slightly different JSON shapes for `/v1/chat/completions`. Need to handle both `choices[0].message.content` and `choices[0].text`.

## Decisions Required

1. **How to detect OpenAI-compatible format vs. custom?**
   - Option A: Always use OpenAI-compatible format when `AI_ENDPOINT_URL` is set
   - Option B: Add a separate `AI_PROVIDER_TYPE` env var to select adapter
   - **Recommendation**: Option A — every local model server (Ollama, vLLM, llama.cpp, LocalAI) speaks OpenAI-compatible format. One adapter covers all.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `agent/src/.../AgentConfig.java` | MODIFY | Add AI_ENDPOINT_URL, AI_API_KEY can be null |
| `agent/src/.../OpenAiCompatibleProvider.java` | CREATE | New provider class |
| `agent/src/.../AiProvider.java` | MODIFY | Interface already exists — no change needed |
| `agent/src/.../TicketProcessor.java` | MODIFY | Use endpoint URL when set |

## Dependencies

- **Depends on this**: bp-29 (provider config), bp-30 (diagnostics tests endpoint)
