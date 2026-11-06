package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;

import java.util.List;

/**
 * Builds the instructions for a harness session.
 */
public final class PromptBuilder {

    private static final int MAX_DOC_CHARS = 40_000;
    private static final int MAX_TOTAL_DOC_CHARS = 120_000;

    public String build(Ticket ticket, List<String> planningDocs, List<String> verificationCommands) {
        return build(ticket, planningDocs, verificationCommands, false);
    }

    public String build(
        Ticket ticket,
        List<String> planningDocs,
        List<String> verificationCommands,
        boolean sandboxedBash
    ) {
        return build(ticket, planningDocs, verificationCommands, sandboxedBash, false);
    }

    public String build(
        Ticket ticket,
        List<String> planningDocs,
        List<String> verificationCommands,
        boolean sandboxedBash,
        boolean egressAllowlist
    ) {
        StringBuilder prompt = new StringBuilder();

        prompt.append("You are an autonomous coding agent working in an isolated git workspace.\n");
        prompt.append("Implement the ticket below completely and verify your work.\n\n");

        prompt.append("## Ticket\n\n");
        prompt.append("ID: ").append(ticket.getId()).append('\n');
        prompt.append("Title: ").append(ticket.getTitle()).append('\n');
        prompt.append("Description:\n").append(ticket.getDescription() == null ? "" : ticket.getDescription()).append("\n\n");

        if (planningDocs != null && !planningDocs.isEmpty()) {
            prompt.append("## Planning documents\n\n");
            int totalChars = 0;
            for (String doc : planningDocs) {
                if (doc == null) continue;
                if (totalChars >= MAX_TOTAL_DOC_CHARS) {
                    prompt.append("[remaining planning documents omitted: prompt budget exhausted]\n\n");
                    break;
                }
                int remainingBudget = MAX_TOTAL_DOC_CHARS - totalChars;
                int perDocBudget = Math.min(MAX_DOC_CHARS, remainingBudget);
                String value = doc.length() > perDocBudget
                    ? doc.substring(0, perDocBudget) + "\n[truncated]"
                    : doc;
                prompt.append(value).append("\n\n");
                totalChars += value.length();
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

        if (sandboxedBash) {
            prompt.append("## Sandboxed shell\n\n");
            prompt.append("- The built-in `bash`/`shell` tool is disabled. Use the ");
            prompt.append("`sandbox_bash` tool for every shell command.\n");
            prompt.append("- Commands run in a disposable sandbox where the workspace is mounted ");
            prompt.append("at `/workspace`. Prefer relative paths in shell commands; the read/edit ");
            prompt.append("tools still use the normal workspace paths.\n");
            prompt.append("- The sandbox has no Git credentials. ");
            if (egressAllowlist) {
                prompt.append("Network access is limited to the approved package registries ");
                prompt.append("through the egress proxy; external DNS is blocked.\n\n");
            } else {
                prompt.append("It has no network access; installs that need the network must use ");
                prompt.append("a pre-populated workspace.\n\n");
            }
        }

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
