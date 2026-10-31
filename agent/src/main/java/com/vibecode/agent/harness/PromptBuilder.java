package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;

import java.util.List;

/**
 * Builds the instructions for a harness session.
 */
public final class PromptBuilder {

    private static final int MAX_DOC_CHARS = 40_000;

    public String build(Ticket ticket, List<String> planningDocs, List<String> verificationCommands) {
        StringBuilder prompt = new StringBuilder();

        prompt.append("You are an autonomous coding agent working in an isolated git workspace.\n");
        prompt.append("Implement the ticket below completely and verify your work.\n\n");

        prompt.append("## Ticket\n\n");
        prompt.append("ID: ").append(ticket.getId()).append('\n');
        prompt.append("Title: ").append(ticket.getTitle()).append('\n');
        prompt.append("Description:\n").append(ticket.getDescription() == null ? "" : ticket.getDescription()).append("\n\n");

        if (planningDocs != null && !planningDocs.isEmpty()) {
            prompt.append("## Planning documents\n\n");
            for (String doc : planningDocs) {
                if (doc == null) continue;
                String value = doc.length() > MAX_DOC_CHARS
                    ? doc.substring(0, MAX_DOC_CHARS) + "\n[truncated]"
                    : doc;
                prompt.append(value).append("\n\n");
            }
        }

        prompt.append("## Repository rules\n\n");
        prompt.append("- Read AGENTS.md, README.md and ai/CODING.md when present and follow them.\n");
        prompt.append("- Inspect the existing code before editing. Use search/read tools.\n");
        prompt.append("- Prefer precise edits; do not rewrite an existing file blindly.\n");
        prompt.append("- Make the smallest coherent change. No unrelated refactors.\n");
        prompt.append("- Follow the repository's test-first rules when they exist.\n");
        prompt.append("- Do not read .env files, secrets, or paths outside the workspace.\n");
        prompt.append("- Do NOT run git commit, git push, git merge, or create pull requests.\n");
        prompt.append("- Do NOT modify .github/workflows or files under secrets/.\n");
        prompt.append("- If the environment lacks information, make a reasonable, documented assumption; ");
        prompt.append("do not wait for a human in this phase.\n\n");

        prompt.append("## Verification\n\n");
        if (verificationCommands == null || verificationCommands.isEmpty()) {
            prompt.append("Run the project's tests, lint and typecheck before finishing.\n");
        } else {
            prompt.append("Run these commands and fix any failures:\n");
            for (String command : verificationCommands) {
                prompt.append("- ").append(command).append('\n');
            }
        }
        prompt.append('\n');

        prompt.append("## Definition of done\n\n");
        prompt.append("- The ticket behaviour is implemented.\n");
        prompt.append("- Tests/lint/typecheck pass (or the closest available verification).\n");
        prompt.append("- No secrets or unrelated files were changed.\n");
        prompt.append("- End with a concise summary of files changed, tests run, and any residual risk.\n");

        return prompt.toString();
    }
}
