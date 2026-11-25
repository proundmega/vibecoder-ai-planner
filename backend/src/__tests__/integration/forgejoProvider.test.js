const { createProvider } = require('../../providers/git/forgejo');

const BASE_URL = process.env.FORGEJO_BASE_URL;
const TOKEN = process.env.FORGEJO_TOKEN;
const REPO = process.env.FORGEJO_REPO;
const describeIfConfigured = BASE_URL && TOKEN && REPO ? describe : describe.skip;

const api = path => `${BASE_URL.replace(/\/+$/, '')}/api/v1${path}`;
const headers = (extra = {}) => ({ Authorization: `token ${TOKEN}`, ...extra });

describeIfConfigured('Forgejo/Gitea provider (real server)', () => {
  test('connects, branches, creates one PR and cleans up', async () => {
    const provider = createProvider(
      { baseUrl: BASE_URL, credential: TOKEN, authMode: 'pat' },
      process.env.FORGEJO_PROVIDER || 'forgejo');
    const repoPath = REPO.replace(/\.git$/i, '');
    const validation = await provider.validateRepoAccess(repoPath);
    expect(validation.accessible).toBe(true);
    const defaultBranch = validation.defaultBranch || 'main';
    const ticketId = Date.now();
    const branch = await provider.createBranch(
      { repoUrl: repoPath, defaultBranch }, ticketId, 'it');

    try {
      const content = await fetch(api(`/repos/${repoPath}/contents/it-${ticketId}.md`), {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          content: Buffer.from('it').toString('base64'),
          message: 'integration test',
          branch,
        }),
      });
      expect(content.ok).toBe(true);

      const repo = { repoUrl: repoPath, defaultBranch };
      const first = await provider.createReviewRequest(repo, ticketId, 'IT', branch, 'body');
      const second = await provider.createReviewRequest(repo, ticketId, 'IT', branch, 'body');
      expect(first.url).toContain('/pulls/');
      expect(second.number).toBe(first.number);

      const diff = await provider.getReviewDiff(repo, first.number);
      expect(diff.files.map(file => file.filename)).toContain(`it-${ticketId}.md`);

      await fetch(api(`/repos/${repoPath}/pulls/${first.number}`), {
        method: 'PATCH',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ state: 'closed' }),
      });
    } finally {
      await provider.deleteBranch({ repoUrl: repoPath, defaultBranch }, branch);
    }
  }, 60_000);
});
