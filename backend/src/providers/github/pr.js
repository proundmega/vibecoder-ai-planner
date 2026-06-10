async function createTicketPR(api, projectRepo, ticketId, ticketTitle, branchName, ticketDescription) {
  const prTitle = `[Ticket #${ticketId}] ${ticketTitle}`;
  const prBody = buildPRBody(ticketId, ticketTitle, ticketDescription, branchName);

  const pr = await api.createPR(
    projectRepo.owner,
    projectRepo.repo,
    prTitle,
    prBody,
    branchName,
    projectRepo.defaultBranch
  );

  return pr;
}

function buildPRBody(ticketId, ticketTitle, ticketDescription, branchName) {
  let body = `## PR created by Vibecode AI Planner\n\n`;
  body += `**Ticket:** #${ticketId} - ${ticketTitle}\n\n`;
  body += `**Branch:** \`${branchName}\`\n\n`;

  if (ticketDescription) {
    body += `---\n\n`;
    body += `## Description\n\n`;
    body += ticketDescription;
  }

  return body;
}

async function listTicketPRs(api, projectRepo) {
  const prs = await api.listPRs(
    projectRepo.owner,
    projectRepo.repo
  );
  return prs.filter(pr => pr.head.startsWith('vibecode/ticket-'));
}

module.exports = {
  createTicketPR,
  buildPRBody,
  listTicketPRs,
};
