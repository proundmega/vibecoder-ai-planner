const fs = require('fs');
const path = require('path');

const {
  STACKS,
  STACK_ORDER,
  parseStackImages,
  stackImagesFromEnv,
  stackKeyForLanguages,
  selectStackImage,
  stackCatalog,
} = require('../config/stackImages');

const DIGEST = `@sha256:${'a'.repeat(64)}`;
const ROOT = path.resolve(__dirname, '../../..');
const DOCKERFILE = path.join(ROOT, 'agent/sandbox-stacks.Dockerfile');
const BUILD_SCRIPT = path.join(ROOT, 'agent/scripts/build-sandbox-images.sh');
const SMOKE_SCRIPT = path.join(ROOT, 'agent/scripts/smoke-sandbox-stacks.sh');

describe('sandbox stack image catalog', () => {
  it('parses digest-pinned per-stack images and trims whitespace', () => {
    const images = parseStackImages(JSON.stringify({
      node: ` registry.example/node:24${DIGEST} `,
      python: `registry.example/python:3.12${DIGEST}`,
    }));

    expect(images).toEqual({
      node: `registry.example/node:24${DIGEST}`,
      python: `registry.example/python:3.12${DIGEST}`,
    });
    expect(parseStackImages(JSON.stringify({
      go: `registry.example:5000/team/go:1.23${DIGEST}`,
    }))).toEqual({ go: `registry.example:5000/team/go:1.23${DIGEST}` });
  });

  it('treats an empty value as no configured images', () => {
    expect(parseStackImages(undefined)).toEqual({});
    expect(parseStackImages('')).toEqual({});
    expect(stackImagesFromEnv({})).toEqual({});
  });

  it('rejects malformed, unknown or unpinned entries', () => {
    expect(() => parseStackImages('{not-json')).toThrow(/valid JSON/);
    expect(() => parseStackImages('[]')).toThrow(/JSON object/);
    expect(() => parseStackImages(JSON.stringify({ rust: `rust${DIGEST}` })))
      .toThrow(/unknown stack/);
    expect(() => parseStackImages(JSON.stringify({ node: 'node:24' })))
      .toThrow(/pinned by digest/);
    expect(() => parseStackImages(JSON.stringify({ node: 24 })))
      .toThrow(/pinned by digest/);
  });

  it('rejects userinfo, multiple digests and oversized references', () => {
    expect(() => parseStackImages(JSON.stringify({
      node: `user:pass@registry.example/node${DIGEST}`,
    }))).toThrow(/pinned by digest/);
    expect(() => parseStackImages(JSON.stringify({
      node: `registry.example/node${DIGEST}${DIGEST}`,
    }))).toThrow(/pinned by digest/);
    expect(() => parseStackImages(JSON.stringify({
      node: `registry.example/${'a'.repeat(520)}${DIGEST}`,
    }))).toThrow(/max 500/);
  });

  it('reads the catalog from the environment per call', () => {
    const env = { REPO_PROFILE_STACK_IMAGES: JSON.stringify({ go: `golang${DIGEST}` }) };
    expect(stackImagesFromEnv(env)).toEqual({ go: `golang${DIGEST}` });
    expect(stackImagesFromEnv({ REPO_PROFILE_STACK_IMAGES: '{}' })).toEqual({});
  });

  it('selects monorepo for multiple languages and the stack for one', () => {
    expect(stackKeyForLanguages(['node'])).toBe('node');
    expect(stackKeyForLanguages(['node', 'node'])).toBe('node');
    expect(stackKeyForLanguages(['node', 'java'])).toBe('monorepo');
    expect(stackKeyForLanguages([])).toBeNull();
    expect(stackKeyForLanguages(['rust'])).toBeNull();
  });

  it('returns an image only for a configured stack', () => {
    const images = {
      node: `node${DIGEST}`,
      monorepo: `monorepo${DIGEST}`,
    };
    expect(selectStackImage(['node'], images)).toEqual({
      stack: 'node',
      image: `node${DIGEST}`,
    });
    expect(selectStackImage(['node', 'python'], images)).toEqual({
      stack: 'monorepo',
      image: `monorepo${DIGEST}`,
    });
    expect(selectStackImage(['python'], images)).toBeNull();
    expect(selectStackImage([], images)).toBeNull();
  });

  it('describes every shipped stack', () => {
    const catalog = stackCatalog();
    expect(catalog.map((entry) => entry.key)).toEqual([...STACK_ORDER]);
    expect(catalog).toHaveLength(5);
    expect(STACKS.monorepo.languages).toEqual(
      expect.arrayContaining(['node', 'python', 'java', 'go']));
  });
});

describe('prebuilt stack images', () => {
  const dockerfile = fs.readFileSync(DOCKERFILE, 'utf8');

  it('pins every base image and defines a stage per catalog target', () => {
    const fromLines = dockerfile.split('\n')
      .map((line) => line.trim())
      .filter((line) => /^FROM\s/i.test(line));
    expect(fromLines.length).toBeGreaterThanOrEqual(STACK_ORDER.length);
    for (const line of fromLines) {
      expect(line).toMatch(/@sha256:[a-f0-9]{64}(\s|$)/);
    }
    for (const target of STACK_ORDER) {
      expect(dockerfile).toMatch(new RegExp(`AS ${target}\\s*$`, 'm'));
      expect(STACKS[target].target).toBe(target);
      expect(STACKS[target].dockerfile).toBe('agent/sandbox-stacks.Dockerfile');
    }
  });

  it('installs the common sandbox tools and drops to uid 1000', () => {
    for (const tool of ['git', 'bash', 'ripgrep', 'curl', 'jq', 'ca-certificates']) {
      expect(dockerfile).toContain(tool);
    }
    expect(dockerfile).toContain('USER 1000:1000');
  });

  it('exposes pip and pytest on the supervisor PATH for Python stages', () => {
    expect(dockerfile).toContain('python3 -m venv /opt/venv');
    expect(dockerfile).toContain('ln -sf /opt/venv/bin/pip /usr/local/bin/pip');
    expect(dockerfile).toContain('ln -sf /opt/venv/bin/pytest /usr/local/bin/pytest');
    expect(dockerfile).not.toContain('python3-pip');
  });

  it('exposes Java and Go through /usr/local/bin for the sanitized PATH', () => {
    expect(dockerfile).toContain('for tool in java javac jar jshell; do ln -sf');
    expect(dockerfile).toContain('ln -sf /usr/local/go/bin/go /usr/local/bin/go');
    expect(dockerfile).toContain('ENTRYPOINT []');
  });

  it('assembles the monorepo image from the pinned per-stack stages', () => {
    expect(dockerfile).toContain('COPY --from=node /usr/local /usr/local');
    expect(dockerfile).toContain('COPY --from=java /opt/java/openjdk /opt/java/openjdk');
    expect(dockerfile).toContain('COPY --from=go /usr/local/go /usr/local/go');
    expect(dockerfile).not.toContain('openjdk-17-jdk');
    expect(dockerfile).not.toContain('golang-go');
  });

  it('ships a uid-1000 smoke test for Python and monorepo', () => {
    const script = fs.readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(script).toContain('TARGETS=(node python java go monorepo)');
    expect(script).toContain('--user 1000:1000');
    expect(script).toContain('--network none');
    expect(script).toContain('pip install --no-index -r requirements.txt');
    expect(script).toContain('pytest -q');
  });

  it('has a build helper that covers every stage and the pin check', () => {
    const script = fs.readFileSync(BUILD_SCRIPT, 'utf8');
    for (const target of STACK_ORDER) {
      expect(script).toContain(target);
    }
    expect(script).toContain('--check-pins');
    expect(script).toContain('sandbox-image-security.sh');
  });
});
