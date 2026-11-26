const FixBranchResolver = require('../services/FixBranchResolver');

const SHA = 'a'.repeat(40);

function ticket(overrides = {}) {
  return {
    id: 42,
    project_id: 7,
    branch_name: 'feat/ticket-42',
    pr_url: 'https://github.com/example/repo/pull/9',
    reviewed_sha: SHA,
    review_round: 1,
    ...overrides,
  };
}

describe('FixBranchResolver (fg-32b2)', () => {
  it('uses the stored ticket branch and reviewed SHA without a provider call', async () => {
    let calls = 0;
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => {
        calls++;
        return null;
      },
    });

    const resolved = await resolver.resolve(ticket(), { round: 1 });

    expect(calls).toBe(0);
    expect(resolved).toEqual({
      branch: 'feat/ticket-42',
      reviewedSha: SHA,
      round: 1,
    });
  });

  it('falls back to the review head branch and SHA for older rows', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => ({
        branch: 'feat/from-pr',
        headSha: SHA,
      }),
    });

    const resolved = await resolver.resolve(
      ticket({ branch_name: null, reviewed_sha: null }),
      { round: 0 }
    );

    expect(resolved.branch).toBe('feat/from-pr');
    expect(resolved.reviewedSha).toBe(SHA);
    expect(resolved.round).toBe(0);
  });

  it('fills a missing SHA from the review head when the branch is stored', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => ({
        branch: 'feat/ticket-42',
        headSha: SHA,
      }),
    });

    const resolved = await resolver.resolve(
      ticket({ reviewed_sha: null }),
      { round: 2 }
    );

    expect(resolved.branch).toBe('feat/ticket-42');
    expect(resolved.reviewedSha).toBe(SHA);
    expect(resolved.round).toBe(2);
  });

  it('fails closed when the stored branch disagrees with the review head', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => ({
        branch: 'feat/other',
        headSha: SHA,
      }),
    });

    await expect(resolver.resolve(
      ticket({ reviewed_sha: null }),
      { round: 0 }
    )).rejects.toThrow('does not match the PR head branch');
  });

  it('fails closed when no branch or SHA can be resolved', async () => {
    const resolver = new FixBranchResolver({
      getReviewRequest: async () => null,
    });

    await expect(resolver.resolve(
      ticket({ branch_name: null }), { round: 0 }
    )).rejects.toThrow('Could not resolve the review request head');

    await expect(new FixBranchResolver().resolve(
      ticket({ branch_name: null, pr_url: null }), { round: 0 }
    )).rejects.toThrow('Ticket branch is unavailable');

    await expect(new FixBranchResolver().resolve(
      ticket({ reviewed_sha: null, pr_url: null }), { round: 0 }
    )).rejects.toThrow('No reviewed SHA is available');
  });

  it('rejects an invalid SHA and an oversized branch', async () => {
    await expect(new FixBranchResolver().resolve(
      ticket({ reviewed_sha: 'abc1234' }), { round: 0 }
    )).rejects.toThrow('No valid reviewed SHA');

    await expect(new FixBranchResolver().resolve(
      ticket({ branch_name: 'b'.repeat(256) }), { round: 0 }
    )).rejects.toThrow('exceeds 255');
  });
});
