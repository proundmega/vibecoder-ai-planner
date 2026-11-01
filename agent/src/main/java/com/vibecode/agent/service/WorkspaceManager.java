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
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
    private String trustedGitConfig;
    private Path supervisorIndex;
    private Path askPassDirectory;
    private Path askPassScript;

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

        // Clone without authentication first (works for public repos) or with
        // a transient askpass helper for private repos. The token never appears
        // in a command line or in .git/config.
        boolean authenticate = githubToken != null && !githubToken.isBlank()
            && repoUrl.startsWith("https://github.com/");
        if (authenticate) {
            ensureAskPass();
        }
        try {
            runGitAt(repoDir.getParent(), Map.of(), "clone", repoUrl, repoDir.toString());
        } catch (IOException e) {
            throw new IOException("Git clone failed: " + redact(e.getMessage()), e);
        } finally {
            cleanupAskPass();
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

        String commitSha;
        if (supervisorIndex != null) {
            // Publish the exact tree that was guarded. commit-tree does not
            // consult or mutate the agent-controlled index/worktree.
            String tree = runGitWithIndex("write-tree");
            commitSha = runGitWithIndex(
                "commit-tree", tree, "-p", "HEAD", "-m", message).strip();
        } else {
            if (stageFirst) {
                stageAll();
            }
            // --no-verify is redundant with core.hooksPath=/dev/null, but keeps
            // the invariant obvious if an option is ever removed.
            runGit("commit", "--no-verify", "-m", message);
            commitSha = getCommitSha();
        }

        pushCommit(commitSha, branchName);
        return commitSha;
    }

    private void pushCommit(String commitSha, String branchName) throws IOException {
        // Pushing to origin (with a transient askpass helper) gives git a
        // remote-tracking ref, but an explicit lease is still used so a retry
        // can overwrite a branch only if the remote has not moved.
        String pushTarget = "origin";
        boolean authenticate = githubToken != null && !githubToken.isBlank();
        if (authenticate) {
            ensureAskPass();
        }
        try {
            String remoteSha = remoteBranchSha(pushTarget, branchName);
            String lease = "--force-with-lease=refs/heads/" + branchName + ":"
                + (remoteSha == null ? "" : remoteSha);
            runGit("push", "--no-verify", pushTarget,
                commitSha + ":refs/heads/" + branchName, lease);
        } finally {
            cleanupAskPass();
        }
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
        // Reset the agent-controlled index to HEAD before staging. This drops
        // index-only cache entries and clears assume-unchanged/skip-worktree
        // flags so `git add -A` sees the real worktree.
        runGit("read-tree", "HEAD");
        runGit("add", "-A");
    }

    /**
     * Build a supervisor-owned index from HEAD, apply the worktree on top of
     * it, and return a diff computed from index blobs.
     *
     * <p>This deliberately ignores the agent-controlled {@code .git/index}:
     * {@code assume-unchanged}, {@code skip-worktree} and index-only cache
     * entries cannot influence what is guarded or published.</p>
     */
    public DiffSummary stageFreshDiff() throws IOException {
        if (dryRun) {
            return DiffSummary.empty();
        }
        hardenGitRepository();
        discardStaged();
        Path index = Files.createTempFile("vibecode-harness-index-", ".idx");
        Files.deleteIfExists(index);
        this.supervisorIndex = index;

        runGitWithIndex("read-tree", "HEAD");
        runGitWithIndex("add", "-A");
        return diffFromIndex();
    }

    public void discardStaged() {
        Path index = supervisorIndex;
        supervisorIndex = null;
        if (index != null) {
            try {
                Files.deleteIfExists(index);
            } catch (IOException e) {
                log.debug("Could not remove supervisor index {}: {}", index, e.getMessage());
            }
        }
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
        Path root = repoDir.toRealPath();
        Path targetPath = root.resolve(fileOp.getPath()).normalize();
        if (!targetPath.startsWith(root)) {
            throw new IOException("Refusing to write outside the workspace: " + fileOp.getPath());
        }

        Path parent = targetPath.getParent();
        assertExistingAncestorInsideWorkspace(parent, root);

        switch (fileOp.getAction()) {
            case CREATE:
            case MODIFY:
                if (Files.isSymbolicLink(targetPath)) {
                    throw new IOException("Refusing to write through symlink: " + fileOp.getPath());
                }
                Files.createDirectories(parent);
                Path realParent = parent.toRealPath();
                if (!realParent.startsWith(root)) {
                    throw new IOException("Refusing to write outside the workspace: " + fileOp.getPath());
                }
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

    /**
     * Walk up to the nearest existing ancestor and resolve it. A cloned repo
     * may contain a symlinked directory; creating files below it must not
     * escape the workspace.
     */
    private static void assertExistingAncestorInsideWorkspace(Path parent, Path root) throws IOException {
        Path current = parent;
        while (current != null && !Files.exists(current, LinkOption.NOFOLLOW_LINKS)) {
            current = current.getParent();
        }
        if (current == null) {
            throw new IOException("Cannot resolve workspace parent: " + parent);
        }
        Path real = current.toRealPath();
        if (!real.startsWith(root)) {
            throw new IOException("Refusing to write outside the workspace: " + parent);
        }
    }

    private void runGit(String... args) throws IOException {
        runGitCommand(args);
    }

    private String runGitCommand(String... args) throws IOException {
        if (repoDir == null) {
            throw new IOException("Workspace has not been cloned");
        }
        return runGitAt(repoDir, Map.of(), args);
    }

    private String runGitWithIndex(String... args) throws IOException {
        if (supervisorIndex == null) {
            throw new IOException("No supervisor index is active");
        }
        return runGitAt(repoDir, Map.of("GIT_INDEX_FILE", supervisorIndex.toString()), args);
    }

    private String runGitAt(
        Path directory,
        Map<String, String> extraEnvironment,
        String... args
    ) throws IOException {
        Process process = startGit(directory, extraEnvironment, args);
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

    private Process startGit(
        Path directory,
        Map<String, String> extraEnvironment,
        String... args
    ) throws IOException {
        List<String> command = new ArrayList<>();
        command.add(gitBinary);
        command.addAll(SAFE_GIT_OPTIONS);
        command.addAll(List.of(args));

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.directory(directory.toFile());
        pb.redirectErrorStream(true);
        applyGitEnvironment(pb.environment(), extraEnvironment);
        return pb.start();
    }

    private void applyGitEnvironment(
        Map<String, String> environment,
        Map<String, String> extraEnvironment
    ) {
        EnvironmentSanitizer.sanitize(environment);
        // Ignore supervisor ~/.gitconfig and /etc/gitconfig. This removes global
        // credential helpers, URL rewriting (url.*.insteadOf) and filters.
        environment.put("GIT_CONFIG_NOSYSTEM", "1");
        environment.put("GIT_CONFIG_GLOBAL", devNull());
        environment.put("GIT_TERMINAL_PROMPT", "0");
        environment.put("GIT_ASKPASS",
            askPassScript != null ? askPassScript.toString() : devNull());
        if (extraEnvironment != null) {
            environment.putAll(extraEnvironment);
        }
    }

    private static String devNull() {
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "NUL" : "/dev/null";
    }

    /**
     * Create a short-lived GIT_ASKPASS helper. The token is kept out of argv
     * (visible in {@code ps}) and out of .git/config; the script is deleted as
     * soon as the clone/push finishes.
     */
    private void ensureAskPass() throws IOException {
        if (askPassScript != null && Files.isRegularFile(askPassScript)) {
            return;
        }
        cleanupAskPass();
        askPassDirectory = Files.createTempDirectory("vibecode-askpass-");
        askPassScript = askPassDirectory.resolve("askpass.sh");
        String token = shellSingleQuote(githubToken == null ? "" : githubToken);
        String script = "#!/bin/sh\n"
            + "case \"$1\" in\n"
            + "  *Username*) printf '%s\\n' 'oauth2' ;;\n"
            + "  *) printf '%s\\n' " + token + " ;;\n"
            + "esac\n";
        Files.writeString(askPassScript, script, StandardCharsets.UTF_8);
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            Files.setPosixFilePermissions(
                askPassDirectory, PosixFilePermissions.fromString("rwx------"));
            Files.setPosixFilePermissions(
                askPassScript, PosixFilePermissions.fromString("rwx------"));
        }
    }

    private void cleanupAskPass() {
        Path script = askPassScript;
        Path directory = askPassDirectory;
        askPassScript = null;
        askPassDirectory = null;
        if (script != null) {
            try {
                Files.deleteIfExists(script);
            } catch (IOException ignored) {
                // Best effort.
            }
        }
        if (directory != null) {
            try {
                Files.deleteIfExists(directory);
            } catch (IOException ignored) {
                // Best effort.
            }
        }
    }

    private static String shellSingleQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
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

        // --no-renames is essential: with rename detection a protected old path
        // (Jenkinsfile, .env, .github/...) disappears from the changed-file list
        // and only the new, unprotected path remains.
        String porcelain = runGitCommand(
            "status", "--porcelain", "-z", "-uall", "--no-renames");
        Map<String, String> indexBlobs = indexBlobs();
        Map<String, String> headBlobs = headBlobs();
        Map<String, int[]> stagedStats = parseNumstat(
            runGitCommandAllowFailure("diff", "--cached", "--numstat", "-z", "--no-renames"));
        Map<String, int[]> unstagedStats = parseNumstat(
            runGitCommandAllowFailure("diff", "--numstat", "-z", "--no-renames"));
        List<DiffSummary.ChangedFile> files = new ArrayList<>();

        int additions = 0;
        int deletions = 0;
        long bytes = 0;

        String[] entries = porcelain.split("\u0000", -1);
        for (String entry : entries) {
            if (entry == null || entry.length() < 4) {
                continue;
            }
            String code = entry.substring(0, 2);
            String path = entry.substring(3);
            if (path.isBlank()) {
                continue;
            }

            String status;
            if (code.contains("?")) {
                status = "added";
            } else if (code.contains("A")) {
                status = "added";
            } else if (code.contains("D")) {
                status = "deleted";
            } else {
                status = "modified";
            }
            files.add(new DiffSummary.ChangedFile(path, status));

            boolean staged = code.charAt(0) != ' ' && code.charAt(0) != '?';
            Map<String, int[]> stats = staged ? stagedStats : unstagedStats;
            int[] stat = stats.get(path);

            if ("deleted".equals(status)) {
                if (stat != null && stat[1] >= 0) {
                    deletions += stat[1];
                } else {
                    deletions += countBlobLines(headBlobs.get(path));
                }
                continue;
            }

            if (stat != null && stat[0] >= 0 && stat[1] >= 0) {
                additions += stat[0];
                deletions += stat[1];
            } else if (staged && indexBlobs.containsKey(path)) {
                additions += countBlobLines(indexBlobs.get(path));
            } else {
                additions += countLines(repoDir.resolve(path));
            }

            if (staged && indexBlobs.containsKey(path)) {
                bytes += blobSize(indexBlobs.get(path));
            } else {
                bytes += fileSize(repoDir.resolve(path));
            }
        }

        return new DiffSummary(files, additions, deletions, bytes);
    }

    private DiffSummary diffFromIndex() throws IOException {
        String changed = runGitWithIndex(
            "diff", "--cached", "--name-status", "-z", "--no-renames");
        Map<String, int[]> stats = parseNumstat(
            runGitWithIndex("diff", "--cached", "--numstat", "-z", "--no-renames"));
        Map<String, String> indexBlobs = indexBlobs();
        Map<String, String> headBlobs = headBlobs();
        List<DiffSummary.ChangedFile> files = new ArrayList<>();
        int additions = 0;
        int deletions = 0;
        long bytes = 0;

        String[] tokens = changed.split("\u0000", -1);
        for (int i = 0; i + 1 < tokens.length; i += 2) {
            String code = tokens[i];
            String path = tokens[i + 1];
            if (code.isBlank() || path.isBlank()) {
                continue;
            }
            String status;
            if (code.startsWith("A")) {
                status = "added";
            } else if (code.startsWith("D")) {
                status = "deleted";
            } else {
                status = "modified";
            }
            files.add(new DiffSummary.ChangedFile(path, status));

            int[] stat = stats.get(path);
            if (stat != null && stat[0] >= 0 && stat[1] >= 0) {
                additions += stat[0];
                deletions += stat[1];
            } else if ("deleted".equals(status)) {
                deletions += countBlobLines(headBlobs.get(path));
            } else {
                // Binary or `-diff` attribute: fall back to the raw blob so a
                // hostile .gitattributes cannot hide a large text file.
                additions += countBlobLines(indexBlobs.get(path));
            }
            if (!"deleted".equals(status)) {
                bytes += blobSize(indexBlobs.get(path));
            }
        }

        return new DiffSummary(files, additions, deletions, bytes);
    }

    private Map<String, String> indexBlobs() throws IOException {
        return parseLsFiles(runGitWithIndexOrWorking("ls-files", "-s", "-z"));
    }

    private Map<String, String> headBlobs() throws IOException {
        return parseLsFiles(runGitCommand("ls-tree", "-z", "-r", "HEAD"));
    }

    private String runGitWithIndexOrWorking(String... args) throws IOException {
        return supervisorIndex != null ? runGitWithIndex(args) : runGitCommand(args);
    }

    private static Map<String, String> parseLsFiles(String output) {
        Map<String, String> blobs = new HashMap<>();
        if (output == null || output.isBlank()) {
            return blobs;
        }
        for (String entry : output.split("\u0000", -1)) {
            int tab = entry.indexOf('\t');
            if (tab <= 0) {
                continue;
            }
            String metadata = entry.substring(0, tab);
            String path = entry.substring(tab + 1);
            String[] parts = metadata.trim().split("\\s+");
            // ls-files -s:   <mode> <sha> <stage>
            // ls-tree -z -r: <mode> <type> <sha>
            String sha = null;
            for (int i = 1; i < parts.length; i++) {
                if (isObjectId(parts[i])) {
                    sha = parts[i];
                    break;
                }
            }
            if (sha != null) {
                blobs.put(path, sha);
            }
        }
        return blobs;
    }

    private static Map<String, int[]> parseNumstat(String output) {
        Map<String, int[]> stats = new HashMap<>();
        if (output == null || output.isBlank()) {
            return stats;
        }
        for (String entry : output.split("\u0000", -1)) {
            if (entry.isBlank()) {
                continue;
            }
            String[] parts = entry.split("\\t");
            if (parts.length < 3) {
                continue;
            }
            String path = parts[2];
            try {
                stats.put(path, new int[]{
                    Integer.parseInt(parts[0]), Integer.parseInt(parts[1])});
            } catch (NumberFormatException e) {
                // "-" means binary: force the blob fallback.
                stats.put(path, new int[]{-1, -1});
            }
        }
        return stats;
    }

    private static boolean isObjectId(String value) {
        if (value == null || (value.length() != 40 && value.length() != 64)) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
                return false;
            }
        }
        return true;
    }

    private long blobSize(String sha) throws IOException {
        if (sha == null || sha.isBlank()) {
            return 0;
        }
        try {
            return Long.parseLong(runGitWithIndexOrWorking("cat-file", "-s", sha).trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private int countBlobLines(String sha) throws IOException {
        if (sha == null || sha.isBlank()) {
            return 0;
        }
        Process process = startGit(
            repoDir,
            supervisorIndex == null ? Map.of() : Map.of("GIT_INDEX_FILE", supervisorIndex.toString()),
            "cat-file", "blob", sha);
        int newlines = 0;
        try (InputStream input = process.getInputStream()) {
            byte[] buffer = new byte[8_192];
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
        }
        int exit = waitFor(process);
        if (exit != 0) {
            throw new IOException("git cat-file failed for blob " + sha);
        }
        return newlines;
    }

    private static int waitFor(Process process) throws IOException {
        try {
            return process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("git command interrupted", e);
        }
    }

    private long fileSize(Path file) {
        if (file == null || Files.isSymbolicLink(file)
            || !Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
            return 0;
        }
        try {
            return Files.size(file);
        } catch (IOException e) {
            return 0;
        }
    }

    private String runGitCommandAllowFailure(String... args) {
        try {
            return runGitCommand(args);
        } catch (IOException e) {
            log.debug("git {} unavailable: {}", redact(String.join(" ", args)), e.getMessage());
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
        discardStaged();
        cleanupAskPass();
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
