const { Octokit } = require('@octokit/rest');

class GitHubAPI {
  constructor(token) {
    this.octokit = new Octokit({
      auth: token,
      userAgent: 'vibecode-ai-planner',
      request: {
        timeout: 10000,
      },
    });
    this.token = token;
  }

  async retryWithBackoff(fn, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (error.status === 401) {
          throw new Error('GitHub authentication failed: invalid or expired token');
        }

        if (error.status === 403 && error.message.includes('rate limit')) {
          const retryAfter = parseInt(error.headers?.['retry-after'] || '60', 10);
          if (attempt < maxRetries) {
            const delay = Math.min(retryAfter * 1000, 30000);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        if (error.status === 429) {
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        throw error;
      }
    }
    throw lastError;
  }

  async validateToken(owner, repo) {
    return this.retryWithBackoff(async () => {
      const { data } = await this.octokit.repos.get({
        owner,
        repo,
      });
      return {
        accessible: true,
        defaultBranch: data.default_branch,
        private: data.private,
      };
    });
  }

  async createBranch(owner, repo, branchName, fromRef) {
    return this.retryWithBackoff(async () => {
      const { data } = await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${fromRef}`,
      });

      await this.octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: data.object.sha,
      });

      return branchName;
    });
  }

  async createCommit(owner, repo, branchName, message, files) {
    return this.retryWithBackoff(async () => {
      const { data: refData } = await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });

      const { data: tree } = await this.octokit.git.createTree({
        owner,
        repo,
        base_tree: refData.object.sha,
        tree: files.map(file => ({
          path: file.path,
          content: file.content,
          mode: '100644',
          type: 'blob',
        })),
      });

      const { data: commit } = await this.octokit.git.createCommit({
        owner,
        repo,
        message,
        tree: tree.sha,
        parents: [refData.object.sha],
      });

      await this.octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
        sha: commit.sha,
      });

      return commit.sha;
    });
  }

  async pushBranch(owner, repo, branchName) {
    return this.retryWithBackoff(async () => {
      const { data } = await this.octokit.repos.getBranch({
        owner,
        repo,
        branch: branchName,
      });
      return {
        url: data.html_url,
        name: branchName,
      };
    });
  }

  async createPR(owner, repo, title, body, head, base) {
    return this.retryWithBackoff(async () => {
      const { data } = await this.octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
      });
      return {
        id: data.id,
        url: data.html_url,
        number: data.number,
        state: data.state,
        head: data.head.ref,
        base: data.base.ref,
      };
    });
  }

  async listBranches(owner, repo) {
    return this.retryWithBackoff(async () => {
      const { data } = await this.octokit.repos.listBranches({
        owner,
        repo,
      });
      return data.map(b => b.name);
    });
  }

  async listPRs(owner, repo) {
    return this.retryWithBackoff(async () => {
      const { data } = await this.octokit.pulls.list({
        owner,
        repo,
        state: 'open',
      });
      return data.map(pr => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        head: pr.head.ref,
        base: pr.base.ref,
      }));
    });
  }

  async deleteBranch(owner, repo, branchName) {
    return this.retryWithBackoff(async () => {
      await this.octokit.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
      return true;
    });
  }

  async listPRFiles(owner, repo, prNumber) {
    return this.retryWithBackoff(async () => {
      const { data } = await this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });
      return data.map(f => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch || '',
        contentsUrl: f.contents_url,
      }));
    });
  }
}

module.exports = { GitHubAPI };
