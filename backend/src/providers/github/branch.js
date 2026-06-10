const slugify = require('slugify');

function createBranchName(ticketId, ticketTitle) {
  const slug = slugify(ticketTitle, {
    lower: true,
    strict: true,
    max: 50,
  });
  return `vibecode/ticket-${ticketId}-${slug}`;
}

async function createTicketBranch(api, projectRepo, ticketId, ticketTitle) {
  const branchName = createBranchName(ticketId, ticketTitle);

  await api.createBranch(
    projectRepo.owner,
    projectRepo.repo,
    branchName,
    projectRepo.defaultBranch
  );

  return branchName;
}

async function deleteTicketBranch(api, projectRepo, branchName) {
  await api.deleteBranch(
    projectRepo.owner,
    projectRepo.repo,
    branchName
  );
}

async function listTicketBranches(api, projectRepo) {
  const branches = await api.listBranches(
    projectRepo.owner,
    projectRepo.repo
  );
  return branches.filter(b => b.startsWith('vibecode/ticket-'));
}

module.exports = {
  createBranchName,
  createTicketBranch,
  deleteTicketBranch,
  listTicketBranches,
};
