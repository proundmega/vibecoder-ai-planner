const { GitHubAPI } = require('./api');

async function validatePAT(token) {
  const api = new GitHubAPI(token);

  try {
    const { data } = await api.octokit.users.getAuthenticated();
    return {
      valid: true,
      username: data.login,
      name: data.name,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message || 'Invalid token',
    };
  }
}

async function validateRepoAccess(token, owner, repo) {
  const api = new GitHubAPI(token);

  try {
    const result = await api.validateToken(owner, repo);
    return {
      accessible: result.accessible,
      defaultBranch: result.defaultBranch,
      private: result.private,
      error: null,
    };
  } catch (error) {
    return {
      accessible: false,
      defaultBranch: null,
      private: null,
      error: error.message,
    };
  }
}

function parseRepoUrl(repoUrl) {
  const urlPatterns = [
    /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/,
    /^([^/]+)\/([^/]+)$/,
  ];

  for (const pattern of urlPatterns) {
    const match = repoUrl.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
}

module.exports = {
  validatePAT,
  validateRepoAccess,
  parseRepoUrl,
};
