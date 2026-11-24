const { validateRepoProfile } = require('../validators/repoProfiles');

function profile(overrides = {}) {
  return {
    schema_version: 1,
    repo_url: 'https://github.com/acme/app',
    verify: ['npm test'],
    ...overrides,
  };
}

function messages(result) {
  return (result.error?.details || []).map(detail => detail.message).join('; ');
}

describe('repo profile flaky-test and test-data schema', () => {
  it('accepts flaky tests, a retry cap and test-data hooks', () => {
    const result = validateRepoProfile(profile({
      flaky_tests: ['test/known-flake.test.js', 'e2e/timing.spec.js'],
      flaky_retries: 2,
      test_data: {
        setup: ['npm run seed'],
        cleanup: ['npm run seed:reset'],
      },
    }));

    expect(result.error).toBeUndefined();
    expect(result.value.flaky_tests).toEqual([
      'test/known-flake.test.js',
      'e2e/timing.spec.js',
    ]);
    expect(result.value.flaky_retries).toBe(2);
    expect(result.value.test_data.setup).toEqual(['npm run seed']);
  });

  it('defaults the retry cap to 2 and hooks to empty', () => {
    const result = validateRepoProfile(profile());

    expect(result.error).toBeUndefined();
    expect(result.value.flaky_retries).toBe(2);
    expect(result.value.test_data).toEqual({ setup: [], cleanup: [] });
  });

  it('rejects empty, control-character and oversized flaky entries', () => {
    expect(messages(validateRepoProfile(profile({
      flaky_tests: [''],
    })))).toMatch(/flaky_tests/);
    expect(messages(validateRepoProfile(profile({
      flaky_tests: ['bad\nname'],
    })))).toMatch(/flaky_tests/);
    expect(messages(validateRepoProfile(profile({
      flaky_tests: ['x'.repeat(501)],
    })))).toMatch(/flaky_tests/);
  });

  it('rejects a retry cap outside 0-2 and too many entries', () => {
    expect(messages(validateRepoProfile(profile({
      flaky_retries: 3,
    })))).toMatch(/flaky_retries/);
    expect(messages(validateRepoProfile(profile({
      flaky_tests: Array.from({ length: 21 }, (_, i) => `test/flake-${i}.js`),
    })))).toMatch(/flaky_tests/);
  });

  it('rejects secrets and excessive test-data commands', () => {
    expect(messages(validateRepoProfile(profile({
      test_data: { setup: ['DB_PASSWORD=hunter2 npm run seed'], cleanup: [] },
    })))).toMatch(/test_data\.setup/);
    expect(messages(validateRepoProfile(profile({
      test_data: {
        setup: Array.from({ length: 21 }, (_, i) => `npm run seed-${i}`),
        cleanup: [],
      },
    })))).toMatch(/test_data\.setup/);
    expect(messages(validateRepoProfile(profile({
      test_data: { setup: [], cleanup: [], unknown: ['x'] },
    })))).toMatch(/unknown/);
  });
});
