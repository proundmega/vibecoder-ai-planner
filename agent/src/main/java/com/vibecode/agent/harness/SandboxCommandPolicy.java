package com.vibecode.agent.harness;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Supervisor-side command policy for the OpenCode bash bridge.
 *
 * <p>This mirrors the OpenCode config deny-list for commands that must never be
 * issued by the model. It is defense in depth, not the security boundary: the
 * sandbox has no credentials, no Docker socket and no direct egress, so a
 * bypass still cannot publish or reach the host.</p>
 */
final class SandboxCommandPolicy {

    private static final List<Rule> DENY = List.of(
        rule("git push", "\\bgit\\b[^;&|\\n]*\\bpush\\b"),
        rule("git commit", "\\bgit\\b[^;&|\\n]*\\bcommit\\b"),
        rule("git merge", "\\bgit\\b[^;&|\\n]*\\bmerge\\b"),
        rule("git reset --hard", "\\bgit\\b[^;&|\\n]*\\breset\\b[^;&|\\n]*--hard\\b"),
        rule("git clean", "\\bgit\\b[^;&|\\n]*\\bclean\\b"),
        rule("git remote change", "\\bgit\\b[^;&|\\n]*\\bremote\\b[^;&|\\n]*\\b(add|set-url)\\b"),
        rule("rm -rf", "\\brm\\b[^;&|\\n]*\\s-[a-z]*r[a-z]*f[a-z]*\\b"),
        rule("sudo", "\\bsudo\\b"),
        rule("su", "\\bsu\\b"),
        rule("docker", "\\bdocker\\b"),
        rule("podman", "\\bpodman\\b"),
        rule("kubectl", "\\bkubectl\\b"),
        rule("nsenter", "\\bnsenter\\b"),
        rule("mount", "\\bmount\\b"),
        rule("umount", "\\bumount\\b"),
        rule("curl piped to a shell", "\\bcurl\\b[^;|\\n]*\\|[^;|\\n]*\\b(ba)?sh\\b"),
        rule("wget piped to a shell", "\\bwget\\b[^;|\\n]*\\|[^;|\\n]*\\b(ba)?sh\\b")
    );

    private SandboxCommandPolicy() {
    }

    /** @return a human-readable reason when the command is denied, else null */
    static String denyReason(String command) {
        if (command == null || command.isBlank()) {
            return "command is empty";
        }
        if (command.length() > 200_000) {
            return "command is too large";
        }
        String normalized = command.toLowerCase(Locale.ROOT);
        for (Rule rule : DENY) {
            if (rule.pattern.matcher(normalized).find()) {
                return rule.name;
            }
        }
        return null;
    }

    private static Rule rule(String name, String regex) {
        return new Rule(name, Pattern.compile(regex));
    }

    private record Rule(String name, Pattern pattern) {
    }
}
