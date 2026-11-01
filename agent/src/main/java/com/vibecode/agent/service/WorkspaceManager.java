package com.vibecode.agent.service;

import com.vibecode.agent.harness.DiffSummary;
import com.vibecode.agent.harness.EnvironmentSanitizer;
import com.vibecode.agent.model.FileOperation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Manages the local git workspace for the agent.
 * Handles cloning repos, writing files, git operations, and commit/push.
 *
 * <p>The cloned repository is treated as hostile. Git is always invoked with
 * hooks, fsmonitor and the user/system config disabled, the local
 * {@code .git/config} is restored from a supervisor-owned snapshot before any
 * publish operation, and subprocesses only receive an allowlisted environment.</p>
 */
public class WorkspaceManager {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceManager.class);

    /**
     * Options applied to every supervisor git invocation. {@code --no-verify}
     * is also passed to commit/push; together they prevent agent-authored hooks
     * from running in the supervisor's environment.
     */
    private static final List<String> SAFE_GIT_OPTIONS = List.of(
        "-c", "core.hooksPath=/dev/null",
        "-c", "core.fsmonitor=false",
        "-c", "core.pager=cat",
        "-c", "advice.detachedHead=false"
    );

    private static final int MAX_COUNTED_LINES = 1_000_000;

    private Path repoDir;
    private final String gitBinary;
    private final boolean dryRun;
    private final String githubToken;
    private final Path credentialHelperScript;
    private final String repoCloneDir;
    private final Path cloneRoot;
    private final String repoName;
    private String authenticatedRemoteUrl;
    private String trustedGitConfig;

    public WorkspaceManager(String repoCloneDir, String repoName, boolean dryRun, String githubToken) {
        this.repoCloneDir = repoCloneDir;
        this.cloneRoot = Paths.get(repoCloneDir).toAbsolutePath().normalize();
        this.repoName = repoName;
        this.gitBinary = "git";
        this.dryRun = dryRun;
        this.githubToken = githubToken;
        this.credentialHelperScript = null;
        this.repoDir = null;
    }

    private Path generateRepoDir() {
        String uniqueName = UUID.randomUUID().toString().substring(0, 8) + "-" + sanitizePath(repoName);
        return Paths.get(repoCloneDir, uniqueName).toAbsolutePath().normalize();
    }

    public Path getRepoDir() {
        return repoDir;
    }

    /**
     * Clone a repository to a unique workspace directory.
     */
    public void cloneRepo(String repoUrl, String branchName) throws IOException {
        this.repoDir = generateRepoDir();
        log.info("Cloning repo from {} to {}", repoUrl, repoDir);
        if (dryRun) {
            log.info("[DRY RUN] Would clone {} to {}", repoUrl, repoDir);
            return;
        }
        assertSafeToDelete(repoDir);

        // Remove existing directory if present (from failed previous attempt)
        if (Files.exists(repoDir, LinkOption.NOFOLLOW_LINKS)) {
            log.info("Removing existing directory: {}", repoDir);
            try {
                deletePath(repoDir);
            } catch (IOException e) {
                log.warn("Java delete failed, trying shell rm -rf: {}", e.getMessage());
                runDeleteFallback();
            }
            if (Files.exists(repoDir, LinkOption.NOFOLLOW_LINKS)) {
                log.error("Directory still exists after delete, aborting clone");
                throw new IOException("Failed to remove existing directory: " + repoDir);
            }
        }

        // Create parent directory if needed
        Files.createDirectories(repoDir.getParent());

        // Clone without authentication first (works for public repos)
        // or with a token configured for private repos. The token is removed
        // from .git/config immediately after cloning.
        if (githubToken != null && !githubToken.isBlank() && repoUrl.startsWith("https://github.com/")) {
            String authenticatedUrl = repoUrl.replace("https://github.com/", "https://" + githubToken + "@github.com/");
            try {
                runGitAt(repoDir.getParent(), "clone", authenticatedUrl, repoDir.toString());
            } catch (IOException e) {
                throw new IOException("Git clone failed: " + redact(e.getMessage()), e);
            }
            this.authenticatedRemoteUrl = authenticatedUrl;
            runGit("remote", "set-url", "origin", stripCredentials(authenticatedUrl));
        } else {
            this.authenticatedRemoteUrl = null;
            runGitAt(repoDir.getParent(), "clone", repoUrl, repoDir.toString());
        }

        // Create and checkout the target branch
        runGit("checkout", "-b", branchName);

        // Snapshot the supervisor-owned git config. The harness can modify
        // .git/config with bash, so publishing restores this snapshot first.
        captureTrustedGitConfig();

        log.info("Successfully cloned repo to {} and created branch {}", repoDir, branchName);
    }

    /**
     * Stage every change, commit and push. Publishing always restores the
     * trusted git config and runs git with hooks disabled.
     */
    public String commitAndPush(String message, String branchName) throws IOException {
        return commitAndPushInternal(message, branchName, true);
    }

    /**
     * Publish a tree the supervisor already staged (after the publishing guard
     * ran). Re-staging here would allow a leftover background process to inject
     * files between the guard and the commit.
     */
    public String commitAndPushStaged(String message, String branchName) throws IOException {
        return commitAndPushInternal(message, branchName, false);
    }

    private String commitAndPushInternal(
        String message,
        String branchName,
        boolean stageFirst
    ) throws IOException {
        if (dryRun) {
            log.info("[DRY RUN] Would commit and push: {}", message);
            return "dry-run-sha";
        }

        hardenGitRepository();

        // Configure git identity if not already set (after restoring config).
        runGit("config", "user.email", "agent@vibecode.ai");
        runGit("config", "user.name", "Vibecode Agent");

        if (stageFirst) {
            stageAll();
        }

        // --no-verify is redundant with core.hooksPath=/dev/null, but keeps the
        // invariant obvious if an option is ever removed.
        runGit("commit", "--no-verify", "-m", message);

        // Pushing to an authenticated URL means git has no remote-tracking ref,
        // so plain --force-with-lease is always rejected ("stale info") for an
        // existing branch. Resolve the remote SHA explicitly and pass it as the
        // lease expectation. A retry may overwrite a branch that has not moved.
        String pushTarget = authenticatedRemoteUrl != null && !authenticatedRemoteUrl.isBlank()
            ? authenticatedRemoteUrl
            : "origin";
        String remoteSha = remoteBranchSha(pushTarget, branchName);
        String lease = "--force-with-lease=refs/heads/" + branchName + ":"
            + (remoteSha == null ? "" : remoteSha);
        runGit("push", "--no-verify", pushTarget, "HEAD:refs/heads/" + branchName, lease);

        return getCommitSha();
    }

    /**
     * Stage everything so the guard inspects the exact tree that will be
     * committed. Callers should close the harness before invoking this.
     */
    public void stageAll() throws IOException {
        if (dryRun) {
            return;
        }
        hardenGitRepository();
        runGit("add", "-A");
    }

    /**
     * Get the current commit SHA.
     */
    public String getCommitSha() throws IOException {
        if (dryRun) {
            return "dry-run-sha";
        }
        return runGitCommand("rev-parse", "HEAD");
    }

    /**
     * Get the list of files in the repo (for AI context).
     */
    public List<String> getRepoFileList() throws IOException {
        if (repoDir == null || !Files.exists(repoDir)) {
            return List.of();
        }

        try (var stream = Files.walk(repoDir)) {
            return stream
                .filter(path -> !Files.isSymbolicLink(path))
                .filter(Files::isRegularFile)
                .filter(path -> !path.toString().contains("/.git/"))
                .map(path -> repoDir.relativize(path).toString())
                .collect(Collectors.toList());
        }
    }

    /**
     * Write multiple files to the workspace. Used by the legacy one-shot path
     * only; the harness edits the workspace directly.
     */
    public void writeFiles(List<FileOperation> files) throws IOException {
        if (files == null || files.isEmpty()) {
            log.info("No files to write");
            return;
        }

        if (dryRun) {
            log.info("[DRY RUN] Would write {} files", files.size());
            for (FileOperation fileOp : files) {
                log.info("[DRY RUN]   {} -> {}", fileOp.getAction(), fileOp.getPath());
            }
            return;
        }

        for (FileOperation fileOp : files) {
            writeSingleFile(fileOp);
        }

        log.info("Wrote {} files to workspace", files.size());
    }

    private void writeSingleFile(FileOperation fileOp) throws IOException {
        Path root = repoDir.toAbsolutePath().normalize();
        Path targetPath = root.resolve(fileOp.getPath()).normalize();
        if (!targetPath.startsWith(root)) {
            throw new IOException("Refusing to write outside the workspace: " + fileOp.getPath());
        }

        // Create parent directories if needed
        Files.createDirectories(targetPath.getParent());

        switch (fileOp.getAction()) {
            case CREATE:
            case MODIFY:
                // Write or update file content
                String content = fileOp.getContent();
                if (content != null) {
                    Files.writeString(targetPath, content);
                    log.info("Wrote file: {}", fileOp.getPath());
                }
                break;

            case DELETE:
                if (Files.exists(targetPath, LinkOption.NOFOLLOW_LINKS)) {
                    Files.delete(targetPath);
                    log.info("Deleted file: {}", fileOp.getPath());
                }
                break;
        }
    }

    private void runGit(String... args) throws IOException {
        runGitCommand(args);
    }

    private String runGitCommand(String... args) throws IOException {
        if (repoDir == null) {
            throw new IOException("Workspace has not been cloned");
        }
        return runGitAt(repoDir, args);
    }

    private String runGitAt(Path directory, String... args) throws IOException {
        List<String> command = new ArrayList<>();
        command.add(gitBinary);
        command.addAll(SAFE_GIT_OPTIONS);
        command.addAll(List.of(args));

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(directory.toFile());
        pb.redirectErrorStream(true);
        applyGitEnvironment(pb.environment());

        Process process = pb.start();
        String output = readProcessOutput(process);
        int exitCode;
        try {
            exitCode = process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Git command interrupted: " + e.getMessage());
        }

        if (exitCode != 0) {
            throw new IOException("git " + redact(String.join(" ", args))
                + " failed: " + redact(output));
        }

        // Strip only trailing whitespace: `git status --porcelain` encodes the
        // staged/worktree state in the first two columns, which must be kept.
        return output.stripTrailing();
    }

    private void applyGitEnvironment(java.util.Map<String, String> environment) {
        EnvironmentSanitizer.sanitize(environment);
        // Ignore supervisor ~/.gitconfig and /etc/gitconfig. This removes global
        // credential helpers, URL rewriting (url.*.insteadOf) and filters.
        environment.put("GIT_CONFIG_NOSYSTEM", "1");
        environment.put("GIT_CONFIG_GLOBAL", devNull());
        environment.put("GIT_TERMINAL_PROMPT", "0");
        environment.put("GIT_ASKPASS", devNull());
    }

    private static String devNull() {
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "NUL" : "/dev/null";
    }

    private String readProcessOutput(Process process) throws IOException {
        byte[] buffer = new byte[4096];
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        try (InputStream is = process.getInputStream()) {
            int bytesRead;
            while ((bytesRead = is.read(buffer)) != -1) {
                baos.write(buffer, 0, bytesRead);
            }
        }
        return baos.toString(StandardCharsets.UTF_8);
    }

    private String sanitizePath(String path) {
        return path.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    /**
     * Removes an embedded credential from a GitHub HTTPS URL so it is safe to
     * persist in {@code .git/config}.
     */
    static String stripCredentials(String url) {
        if (url == null) {
            return null;
        }
        return url.replaceFirst("https://[^/@]+@github\\.com/", "https://github.com/");
    }

    private String redact(String value) {
        if (value == null) {
            return "";
        }
        if (githubToken != null && !githubToken.isBlank()) {
            return value.replace(githubToken, "[REDACTED]");
        }
        return value;
    }

    private void captureTrustedGitConfig() throws IOException {
        Path config = repoDir.resolve(".git/config");
        if (!Files.isRegularFile(config, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Cloned repository has no .git/config: " + repoDir);
        }
        this.trustedGitConfig = Files.readString(config, StandardCharsets.UTF_8);
    }

    /**
     * Restore the git config captured at clone time. The harness may have
     * written filters, hooks, credential helpers or url.*.insteadOf rules into
     * the workspace; none of them may influence the supervisor's push.
     */
    private void hardenGitRepository() throws IOException {
        Path gitDir = repoDir.resolve(".git");
        if (Files.isSymbolicLink(gitDir)
            || !Files.isDirectory(gitDir, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Refusing to publish: .git is not a real directory");
        }
        Path config = gitDir.resolve("config");
        if (trustedGitConfig != null) {
            if (Files.isSymbolicLink(config)) {
                Files.deleteIfExists(config);
            }
            Files.writeString(config, trustedGitConfig, StandardCharsets.UTF_8);
        }
    }

    private String remoteBranchSha(String remote, String branchName) throws IOException {
        String output = runGitCommandAllowFailure(
            "ls-remote", "--heads", remote, "refs/heads/" + branchName);
        if (output == null || output.isBlank()) {
            return null;
        }
        for (String line : output.split("\\R")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            String[] parts = trimmed.split("\\s+");
            if (parts.length >= 2 && parts[1].equals("refs/heads/" + branchName)) {
                return parts[0];
            }
        }
        return null;
    }

    private void deletePath(Path path) throws IOException {
        // Delete symlinks themselves, never their targets. walkFileTree is not
        // used with FOLLOW_LINKS, so directory symlinks cannot escape the repo.
        if (Files.isSymbolicLink(path)) {
            Files.deleteIfExists(path);
            return;
        }
        if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
            Files.walkFileTree(path, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.deleteIfExists(file);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                    if (exc != null) {
                        throw exc;
                    }
                    Files.deleteIfExists(dir);
                    return FileVisitResult.CONTINUE;
                }
            });
            return;
        }
        Files.deleteIfExists(path);
    }

    /**
     * @deprecated Use token-in-URL auth in cloneRepo() instead. Kept for tests.
     */
    @Deprecated
    Path createCredentialHelper(Path repoDir, String token) throws IOException {
        Path gitDir = repoDir.resolve(".git");
        Files.createDirectories(gitDir);
        Path helperScript = gitDir.resolve("credential-helper.sh");
        String scriptContent = "#!/bin/sh\necho \"username=oauth2\"\necho \"password=" + token + "\"";
        Files.writeString(helperScript, scriptContent);
        // POSIX permission APIs are unavailable on Windows. The agent ships in a
        // Linux container, but local development on Windows must still work.
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            Files.setPosixFilePermissions(helperScript,
                java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        }
        return helperScript;
    }

    /**
     * Collect the workspace changes as a summary the supervisor can inspect
     * before committing. The harness is never trusted to report its own diff.
     *
     * <p>{@code -uall -z} is essential: without it git collapses untracked
     * directories into a single entry such as {@code ?? .github/}, which would
     * let the real files bypass every protected-path and size check.</p>
     */
    public DiffSummary collectDiff() throws IOException {
        if (repoDir == null || !Files.exists(repoDir)) {
            return DiffSummary.empty();
        }

        String porcelain = runGitCommand("status", "--porcelain", "-z", "-uall");
        List<DiffSummary.ChangedFile> files = new ArrayList<>();
        Set<String> untracked = new HashSet<>();

        String[] entries = porcelain.split("\u0000", -1);
        int index = 0;
        while (index < entries.length) {
            String entry = entries[index++];
            if (entry == null || entry.length() < 4) {
                continue;
            }
            String code = entry.substring(0, 2);
            String path = entry.substring(3);
            if (path.isBlank()) {
                continue;
            }

            // In -z mode a rename/copy is followed by a second NUL-separated
            // field containing the original path.
            if ((code.contains("R") || code.contains("C")) && index < entries.length) {
                index++;
            }

            String status;
            if (code.contains("?")) {
                status = "added";
                untracked.add(path);
            } else if (code.contains("A")) {
                status = "added";
            } else if (code.contains("D")) {
                status = "deleted";
            } else if (code.contains("R")) {
                status = "renamed";
            } else {
                status = "modified";
            }
            files.add(new DiffSummary.ChangedFile(path, status));
        }

        int additions = 0;
        int deletions = 0;
        int[] staged = parseNumstat(runGitCommandAllowFailure("diff", "--numstat", "--cached"));
        int[] unstaged = parseNumstat(runGitCommandAllowFailure("diff", "--numstat"));
        additions += staged[0] + unstaged[0];
        deletions += staged[1] + unstaged[1];

        for (String path : untracked) {
            additions += countLines(repoDir.resolve(path));
        }

        long bytes = 0;
        for (DiffSummary.ChangedFile file : files) {
            if ("deleted".equals(file.status())) {
                continue;
            }
            try {
                Path changed = repoDir.resolve(file.path());
                BasicFileAttributes attrs = Files.readAttributes(
                    changed, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                if (attrs.isRegularFile()) {
                    bytes += attrs.size();
                }
            } catch (IOException ignored) {
                // Missing/broken path: the file count still guards the diff.
            }
        }

        return new DiffSummary(files, additions, deletions, bytes);
    }

    private int[] parseNumstat(String output) {
        int additions = 0;
        int deletions = 0;
        if (output == null || output.isBlank()) {
            return new int[]{0, 0};
        }
        for (String line : output.split("\\R")) {
            String[] parts = line.split("\\t");
            if (parts.length < 3) {
                continue;
            }
            try {
                additions += Integer.parseInt(parts[0]);
                deletions += Integer.parseInt(parts[1]);
            } catch (NumberFormatException ignored) {
                // Binary files report "-" for both counts.
            }
        }
        return new int[]{additions, deletions};
    }

    private String runGitCommandAllowFailure(String... args) {
        try {
            return runGitCommand(args);
        } catch (IOException e) {
            log.debug("git {} unavailable: {}", String.join(" ", args), e.getMessage());
            return "";
        }
    }

    /**
     * Count newlines without assuming UTF-8 and without loading the file into
     * memory. Binary files and huge files are bounded; an {@link IOException}
     * must never abort a publish because of an untracked fixture.
     */
    private int countLines(Path file) {
        if (file == null || Files.isSymbolicLink(file) || !Files.isRegularFile(file)) {
            return 0;
        }
        try (InputStream input = Files.newInputStream(file)) {
            byte[] buffer = new byte[8_192];
            int newlines = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                for (int i = 0; i < read; i++) {
                    if (buffer[i] == '\n') {
                        newlines++;
                        if (newlines > MAX_COUNTED_LINES) {
                            return MAX_COUNTED_LINES + 1;
                        }
                    }
                }
            }
            return newlines;
        } catch (IOException | RuntimeException e) {
            log.debug("Could not count lines in {}: {}", file, e.getMessage());
            return 0;
        }
    }

    /**
     * Delete the workspace directory and all its contents.
     */
    public void cleanup() {
        if (repoDir == null) {
            return;
        }
        try {
            assertSafeToDelete(repoDir);
        } catch (IOException e) {
            log.error("Refusing to clean up workspace outside {}: {}", cloneRoot, e.getMessage());
            return;
        }
        if (Files.exists(repoDir, LinkOption.NOFOLLOW_LINKS)) {
            try {
                deletePath(repoDir);
                log.info("Cleaned up workspace: {}", repoDir);
            } catch (IOException e) {
                log.warn("Java delete failed, trying shell rm -rf: {}", e.getMessage());
                runDeleteFallback();
            }
        }
    }

    private void runDeleteFallback() {
        try {
            ProcessBuilder rmPb = new ProcessBuilder("rm", "-rf", "--", repoDir.toString());
            rmPb.redirectErrorStream(true);
            Process rmProcess = rmPb.start();
            rmProcess.waitFor();
            log.info("Cleaned up workspace via rm -rf: {}", repoDir);
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.error("Failed to cleanup workspace {}: {}", repoDir, ex.getMessage());
        }
    }

    /**
     * Refuse to delete anything outside REPO_CLONE_DIR (or the clone root
     * itself). This bounds a compromised workspace path or a symlinked
     * repository directory.
     */
    private void assertSafeToDelete(Path path) throws IOException {
        Path normalized = path.toAbsolutePath().normalize();
        if (!normalized.startsWith(cloneRoot) || normalized.equals(cloneRoot)) {
            throw new IOException("Path is outside the clone root: " + normalized);
        }
    }
}
