const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { LocalGitProvider, gitArgs } = require('../providers/git/local');

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

describe('local filesystem provider', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecode-local-root-'));
    process.env.LOCAL_GIT_ROOT = root;
  });

  afterEach(() => {
    delete process.env.LOCAL_GIT_ROOT;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts an absolute repository path under the root', async () => {
    const repo = initRepo(path.join(root, 'project'));
    const provider = new LocalGitProvider({ authMode: 'none' });

    const parsed = provider.parseRepoUrl(repo);
    const validation = await provider.validateRepoAccess(repo, null);

    expect(parsed.protocol).toBe('file');
    expect(parsed.cloneUrl).toBe(`file://${fs.realpathSync(repo)}`);
    expect(validation).toMatchObject({
      accessible: true,
      defaultBranch: 'main',
    });
  });

  it('accepts a file:// URL and reports a bare repository default branch', async () => {
    const repo = initRepo(path.join(root, 'bare.git'), { bare: true });
    const provider = new LocalGitProvider({ authMode: 'none' });

    const parsed = provider.parseRepoUrl(`file://${repo}`);
    const validation = await provider.validateRepoAccess(`file://${repo}`, null);

    expect(parsed.cloneUrl).toBe(`file://${fs.realpathSync(repo)}`);
    expect(validation).toMatchObject({ accessible: true, defaultBranch: 'main' });
  });

  it('rejects a path outside the configured root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecode-local-outside-'));
    try {
      initRepo(path.join(outside, 'project'));
      const provider = new LocalGitProvider({ authMode: 'none' });

      expect(() => provider.parseRepoUrl(path.join(outside, 'project')))
        .toThrow('outside LOCAL_GIT_ROOT');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlink that escapes the root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecode-local-outside-'));
    try {
      initRepo(path.join(outside, 'project'));
      const link = path.join(root, 'escape');
      fs.symlinkSync(path.join(outside, 'project'), link);

      const provider = new LocalGitProvider({ authMode: 'none' });
      expect(() => provider.parseRepoUrl(link)).toThrow('outside LOCAL_GIT_ROOT');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a subdirectory of a work tree', async () => {
    const repo = initRepo(path.join(root, 'worktree'));
    const sub = path.join(repo, 'sub');
    fs.mkdirSync(sub);
    const provider = new LocalGitProvider({ authMode: 'none' });

    await expect(provider.validateRepoAccess(sub, null)).resolves.toMatchObject({
      accessible: false,
      error: 'Path must be the repository root',
    });
  });

  it('requires LOCAL_GIT_ROOT for filesystem paths', () => {
    const repo = initRepo(path.join(root, 'project'));
    delete process.env.LOCAL_GIT_ROOT;

    const provider = new LocalGitProvider({ authMode: 'none' });
    expect(() => provider.parseRepoUrl(repo)).toThrow('require LOCAL_GIT_ROOT');
  });

  it('rejects a directory that is not a git repository', async () => {
    const notRepo = path.join(root, 'plain');
    fs.mkdirSync(notRepo);
    const provider = new LocalGitProvider({ authMode: 'none' });

    await expect(provider.validateRepoAccess(notRepo, null))
      .resolves.toMatchObject({
        accessible: false,
        error: 'Path is not a git repository',
      });
  });

  it('trusts the resolved local path for cross-UID reads', () => {
    expect(gitArgs('/srv/git/repo.git', ['rev-parse', 'HEAD'])).toEqual([
      '-C',
      '/srv/git/repo.git',
      '-c',
      'safe.directory=/srv/git/repo.git',
      'rev-parse',
      'HEAD',
    ]);
  });

  it('keeps accepting SSH URLs', () => {
    const provider = new LocalGitProvider({ authMode: 'ssh' });

    expect(provider.parseRepoUrl('ssh://git@git.example.com/group/repo.git'))
      .toMatchObject({ protocol: 'ssh', host: 'git.example.com' });
    expect(provider.parseRepoUrl('git@git.example.com:group/repo.git'))
      .toMatchObject({ protocol: 'ssh', host: 'git.example.com' });
  });
});
