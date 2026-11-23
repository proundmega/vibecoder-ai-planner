const { parseJsonValue } = require('../utils/jsonValue');

describe('parseJsonValue', () => {
  it('returns parsed JSONB values unchanged', () => {
    const definitions = [{ key: '01_SIMPLE_TASKS.md', content: 'x' }];
    expect(parseJsonValue(definitions, [])).toBe(definitions);
  });

  it('parses JSON strings for legacy callers and test doubles', () => {
    expect(parseJsonValue('[{"key":"a.md"}]', [])).toEqual([{ key: 'a.md' }]);
  });

  it('returns non-string values unchanged', () => {
    const objectValue = { key: 'a.md' };
    expect(parseJsonValue(objectValue, [])).toBe(objectValue);
    expect(parseJsonValue(42, [])).toBe(42);
  });

  it('returns the fallback for null or malformed values', () => {
    expect(parseJsonValue(null, [])).toEqual([]);
    expect(parseJsonValue('not json', [])).toEqual([]);
  });
});
