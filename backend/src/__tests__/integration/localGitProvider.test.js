const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { LocalGitProvider } = require('../../providers/git/local');

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo(dir, { bare = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (bare) {
    git(['init', '--bare', '-b', 'main', dir]);
    return dir;
  }
  git(['init', '-b', 'main', dir]);
  git(['-C', dir, '-c', 'user.email=test@example.com', '-c', 'user.name=Test',
    'commit', '--allow-empty', '-m', 'init']);
  return dir;
}

describe('local Git provider with real git repositories', () => {
  let root;
  let provider;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecode-local-integration-'));
    process.env.LOCAL_GIT_ROOT = root;
    provider = new LocalGitProvider({ authMode: 'none' });
  });

  afterAll(() => {
    delete process.env.LOCAL_GIT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('connects a local working repository and exposes a file clone URL', async () => {
    const repo = initRepo(path.join(root, 'project'));

    const parsed = provider.parseRepoUrl(repo);
    const validation = await provider.validateRepoAccess(repo, null);

    expect(parsed.cloneUrl).toBe(`file://${fs.realpathSync(repo)}`);
    expect(validation).toMatchObject({ accessible: true, defaultBranch: 'main' });
  });

  it('reads the default branch from a local bare repository', async () => {
    const repo = initRepo(path.join(root, 'bare.git'), { bare: true });

    await expect(provider.validateRepoAccess(`file://${repo}`, null))
      .resolves.toMatchObject({ accessible: true, defaultBranch: 'main' });
  });
});
