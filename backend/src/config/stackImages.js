/**
 * Prebuilt sandbox stack images (fg-39 FR3 / D7).
 *
 * The repository ships one pinned image per stack. Publishing is an operator
 * step: after `agent/scripts/build-sandbox-images.sh` and a registry push, set
 * REPO_PROFILE_STACK_IMAGES to the digest-pinned references. Detection only
 * proposes an image when it is configured here; it never invents a tag.
 */

// No userinfo and exactly one digest separator; registry ports and tags are allowed.
const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const MAX_IMAGE_LENGTH = 500;

const STACKS = Object.freeze({
  node: Object.freeze({
    label: 'Node 24',
    languages: ['node'],
    dockerfile: 'agent/sandbox-stacks.Dockerfile',
    target: 'node',
    tools: ['node 24', 'npm', 'git', 'ripgrep', 'build-essential'],
  }),
  python: Object.freeze({
    label: 'Python 3.12',
    languages: ['python'],
    dockerfile: 'agent/sandbox-stacks.Dockerfile',
    target: 'python',
    tools: ['python 3.12', 'pip', 'git', 'ripgrep', 'build-essential'],
  }),
  java: Object.freeze({
    label: 'Java 21 + Maven 3.9',
    languages: ['java'],
    dockerfile: 'agent/sandbox-stacks.Dockerfile',
    target: 'java',
    tools: ['java 21', 'maven 3.9.11', 'git', 'ripgrep', 'build-essential'],
  }),
  go: Object.freeze({
    label: 'Go 1.23',
    languages: ['go'],
    dockerfile: 'agent/sandbox-stacks.Dockerfile',
    target: 'go',
    tools: ['go 1.23', 'git', 'ripgrep', 'build-essential'],
  }),
  monorepo: Object.freeze({
    label: 'Monorepo (Node, Python, Java, Go)',
    languages: ['node', 'python', 'java', 'go'],
    dockerfile: 'agent/sandbox-stacks.Dockerfile',
    target: 'monorepo',
    tools: [
      'node 24', 'python 3.12', 'java 21', 'go 1.23', 'maven 3.9.11',
      'git', 'ripgrep', 'build-essential',
    ],
  }),
});

const STACK_ORDER = Object.freeze(['node', 'python', 'java', 'go', 'monorepo']);

function parseStackImages(raw) {
  if (raw == null || String(raw).trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new Error('REPO_PROFILE_STACK_IMAGES must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('REPO_PROFILE_STACK_IMAGES must be a JSON object');
  }
  const images = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(STACKS, key)) {
      throw new Error(`REPO_PROFILE_STACK_IMAGES has an unknown stack: ${key}`);
    }
    const image = typeof value === 'string' ? value.trim() : '';
    if (!image || image.length > MAX_IMAGE_LENGTH || !IMAGE.test(image)) {
      throw new Error(
        `REPO_PROFILE_STACK_IMAGES.${key} must be pinned by digest `
        + `(@sha256:..., max ${MAX_IMAGE_LENGTH} characters)`);
    }
    images[key] = image;
  }
  return images;
}

function stackImagesFromEnv(env = process.env) {
  return parseStackImages(env.REPO_PROFILE_STACK_IMAGES);
}

function stackKeyForLanguages(languages) {
  const unique = [...new Set((languages || []).filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length > 1) return 'monorepo';
  return Object.prototype.hasOwnProperty.call(STACKS, unique[0]) ? unique[0] : null;
}

function selectStackImage(languages, images = {}) {
  const stack = stackKeyForLanguages(languages);
  if (!stack || !images[stack]) return null;
  return { stack, image: images[stack] };
}

function stackCatalog() {
  return STACK_ORDER.map((key) => ({ key, ...STACKS[key] }));
}

module.exports = {
  IMAGE,
  STACKS,
  STACK_ORDER,
  parseStackImages,
  stackImagesFromEnv,
  stackKeyForLanguages,
  selectStackImage,
  stackCatalog,
};
