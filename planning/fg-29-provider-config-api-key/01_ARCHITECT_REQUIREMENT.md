# 01_ARCHITECT_REQUIREMENT.md — fg-29 Provider Config API Key Field

## Problem Statement

The Provider Config tab in ProjectDetail.vue allows users to configure the AI provider and model for a project. However, cloud providers (OpenAI, Anthropic Claude) require an API key to function, but there is no input field for the user to enter their API key. This means users cannot configure cloud providers through the UI — they can only configure local models (Ollama, vLLM, etc.) which don't require API keys.

Additionally, there are field name mismatches between the frontend, validator, and controller:
- Frontend sends `endpoint_url`, `fallback_provider` (snake_case)
- Validator expects `endpoint_url`, `fallback_provider` (snake_case) ✓
- Controller destructures `endpointUrl`, `fallbackProvider` (camelCase) ✗
- Controller expects `apiKey` (raw string) but validator expects `api_key_credential_id` (UUID) ✗

## Requirements

### Functional Requirements

1. **API Key Input Field**: Add an API key input field to the Provider Config tab
   - Visible for all provider types (openai, claude, ollama, vllm, llamacpp, custom)
   - Marked as optional with "(optional)" label and placeholder text
   - Input type should be `password` to mask the key while typing
   - Local models may still need auth tokens (Ollama with auth, vLLM with tokens, etc.)

2. **Field Name Alignment**: Standardize field names across the stack
   - Frontend sends snake_case (`endpoint_url`, `api_key`, `fallback_provider`)
   - Validator accepts snake_case (`endpoint_url`, `api_key`, `fallback_provider`)
   - Controller receives snake_case and maps to DB columns

3. **API Key Storage**: Store the API key in the `provider_configs` table
   - Use the existing `api_key_credential_id` column or create a new `api_key_encrypted` column
   - Encrypt the API key before storage using the existing `encrypt()` utility
   - On GET, return the masked API key (e.g., `sk-****1234`) or null

4. **Test Connection**: The "Test Connection" button should use the API key from the form when provided

### Non-Functional Requirements

- No database migration required if we use existing `api_key_credential_id` column as a raw encrypted string
- Maintain backward compatibility with existing provider configs
- No breaking changes to existing API routes

## Acceptance Criteria

- [ ] User can navigate to Provider Config tab and see an API key input field for cloud providers
- [ ] API key field is hidden for local model providers
- [ ] User can enter an API key and save the configuration
- [ ] Backend stores the API key encrypted
- [ ] GET returns the masked API key (or null if not set)
- [ ] Test Connection works with the provided API key
- [ ] Frontend typecheck passes
- [ ] All existing tests pass

## Out of Scope

- Credential management (the `project_providers` table with named API key providers)
- API key rotation or expiry
- Integration with external secret managers
- Multi-provider configurations per project
