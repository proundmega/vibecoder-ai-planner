const {
  redactPayload,
  containsSecret,
} = require('../utils/harnessRedaction');

describe('harnessRedaction', () => {
  it('redacts credential-shaped keys and flags the event', () => {
    const result = redactPayload({
      apiKey: 'sk-abcdefghijklmnopqrstuvwxyz1234',
      nested: { password: 'super-secret-value', ok: 'visible' },
    });

    expect(result.secretFlagged).toBe(true);
    expect(result.payload.apiKey).toBe('[REDACTED]');
    expect(result.payload.nested.password).toBe('[REDACTED]');
    expect(result.payload.nested.ok).toBe('visible');
    expect(result.payload._redaction.secret_flagged).toBe(true);
  });

  it('redacts known token formats inside ordinary strings', () => {
    const result = redactPayload({
      log: 'push failed with Bearer abcdefghijklmnopqrstuvwxyz012345 and ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    });

    expect(result.secretFlagged).toBe(true);
    expect(result.payload.log).not.toContain('ghp_');
    expect(result.payload.log).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });

  it('redacts PII inside event strings at ingest', () => {
    const result = redactPayload({
      message: 'mail alice@example.com, call (415) 555-2671, id 1234567890',
    });

    expect(result.piiFlagged).toBe(true);
    expect(result.payload.message).toContain('[REDACTED_EMAIL]');
    expect(result.payload.message).toContain('[REDACTED_PHONE]');
    expect(result.payload.message).toContain('1234567890');
    expect(result.payload._redaction.pii_flagged).toBe(true);
  });

  it('redacts URL userinfo', () => {
    const result = redactPayload({
      url: 'postgresql://user:hunter2@db.internal:5432/app',
    });
    expect(result.payload.url).toBe('postgresql://[REDACTED]@db.internal:5432/app');
  });

  it('hashes file content and prompts instead of storing them', () => {
    const result = redactPayload({
      content: 'const secret = "this is a whole source file";',
      prompt: 'Implement the entire ticket from scratch',
    });

    expect(result.payload.content.redacted).toBe('content');
    expect(result.payload.content.sha256).toHaveLength(64);
    expect(result.payload.prompt.redacted).toBe('content');
    expect(result.payload._redaction.hashed_fields).toEqual(
      expect.arrayContaining(['content', 'prompt'])
    );
  });

  it('truncates very long strings with a hash', () => {
    const previous = process.env.HARNESS_EVENT_MAX_STRING;
    process.env.HARNESS_EVENT_MAX_STRING = '20';
    try {
      const result = redactPayload({ note: 'x'.repeat(100) });
      expect(result.payload.note.redacted).toBe('truncated');
      expect(result.payload.note.length).toBe(100);
      expect(result.truncated).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.HARNESS_EVENT_MAX_STRING;
      else process.env.HARNESS_EVENT_MAX_STRING = previous;
    }
  });

  it('caps arrays and object depth', () => {
    const result = redactPayload(
      { items: Array.from({ length: 5 }, (_, i) => i) },
      { maxArray: 2 }
    );
    expect(result.payload.items).toEqual([0, 1]);
    expect(result.truncated).toBe(true);
  });

  it('keeps token-count fields visible', () => {
    const result = redactPayload({
      inputTokens: 1200,
      outputTokens: 300,
      cachedTokens: 50,
      input_tokens: 1200,
      output_tokens: 300,
      token_count: 1800,
      access_token: 'ghp_abcdefghijklmnopqrstuvwxyz012345',
    });

    expect(result.payload.inputTokens).toBe(1200);
    expect(result.payload.outputTokens).toBe(300);
    expect(result.payload.cachedTokens).toBe(50);
    expect(result.payload.input_tokens).toBe(1200);
    expect(result.payload.output_tokens).toBe(300);
    expect(result.payload.token_count).toBe(1800);
    expect(result.payload.access_token).toBe('[REDACTED]');
    expect(result.secretFlagged).toBe(true);
  });

  it('never returns raw secret values to containsSecret callers', () => {
    expect(containsSecret('token=abcdefghijklmnop')).toBe(true);
    expect(containsSecret('an ordinary sentence')).toBe(false);
  });
});
