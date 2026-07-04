# 01_ARCHITECT_REQUIREMENT.md — Structured Logging Format

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

Winston logs must use JSON format for log aggregation (Datadog, CloudWatch, ELK). Currently logs are plain text.

---

## Scope

- Configure Winston JSON formatter
- Add structured fields: `requestId`, `userId`, `ip`, `method`, `path`, `status`, `duration`
- Add log levels: `error`, `warn`, `info`, `http`, `debug`
- Mask sensitive fields (passwords, API keys, tokens)

---

## Assumptions

- `winston` is already installed and configured in `src/index.js` (confirmed by `const winston = require('winston')`)
- The existing logger uses `winston.createLogger()` with a `transports.Console` transport
- No other logging library is in use (no `pino`, `bunyan`, etc.)
- `winston-format` or similar formatter package is NOT currently a dependency (will need to be added)
- Log files are NOT currently written to disk (console-only logging)
- The `requestId` is NOT currently generated (will need middleware to create it)
- Sensitive data masking should use a custom winston transform or `winston-redact` package

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **Which log aggregation service?**
   - Datadog — JSON format with specific field names
   - CloudWatch — JSON format, CloudWatch Insights queries
   - ELK stack — JSON format, Elasticsearch ingestion
   - Generic JSON — works with any JSON log parser

2. **Should we keep console logs in human-readable format?**
   - Yes — JSON for file, human-readable for console (development)
   - No — JSON everywhere for consistency

3. **Which fields to mask?**
   - `password`, `token`, `apiKey`, `authorization` — all sensitive headers/body

---

## Acceptance Criteria

- [ ] Winston logger outputs valid JSON on every log line (parseable with `JSON.parse()`)
- [ ] All log lines include a `requestId` field (generated per-request via middleware)
- [ ] All log lines include `timestamp` field in ISO 8601 format
- [ ] Log levels are used correctly: `error` for 5xx, `warn` for 4xx, `info` for 2xx/3xx, `debug` for tracing
- [ ] Sensitive fields (`password`, `token`, `apiKey`, `authorization`) are masked as `***REDACTED***`
- [ ] Request metadata (`method`, `path`, `ip`, `status`, `duration`) is included in access logs
- [ ] Console output is human-readable in development (`NODE_ENV=development`)
- [ ] Console output is JSON in production (`NODE_ENV=production`)
- [ ] No passwords, tokens, or API keys appear in plain text in any log output
- [ ] Unit tests verify JSON log format and sensitive field masking
- [ ] Linting passes with no errors

---

## Out of Scope

- Log file rotation (winston-daily-rotate-file — separate concern)
- Log aggregation pipeline setup (Datadog agent, CloudWatch agent, etc.)
- Log-based alerting rules
- Log sampling or sampling rate configuration
- Distributed tracing integration (OpenTelemetry, Jaeger — separate concern)
- Log retention policy implementation

---

## Testing Checklist

- [ ] Logs are valid JSON
- [ ] Request ID included in all logs
- [ ] Sensitive fields are masked
- [ ] Console logs are human-readable in development
- [ ] File logs are JSON in all environments

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors

---

## Anti-Patterns to Avoid

- ❌ Logging passwords or tokens in plain text
- ❌ Console-only logging (no structured output)
- ❌ Overly verbose debug logs in production

---

*Ready for design phase.*
