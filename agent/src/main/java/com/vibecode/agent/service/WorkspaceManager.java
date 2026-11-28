package com.vibecode.agent.service;

import com.vibecode.agent.harness.DiffSummary;
import com.vibecode.agent.harness.EnvironmentSanitizer;
import com.vibecode.agent.harness.ProcessGroup;
import com.vibecode.agent.model.FileOperation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.FileTime;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

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

    /**
     * Private ref namespace for the supervisor's own fetches. Resolving the
     * remote head through this ref works for a {@code --single-branch} clone of
     * a different branch, where {@code refs/remotes/origin/<branch>} is never
     * created.
     */
    private static final String FETCHED_REF_PREFIX = "refs/vibecode/fetched/";

    private static final int MAX_COUNTED_LINES = 1_000_000;
    private static final long MAX_COUNTED_BYTES = 10L * 1024 * 1024;
    /**
     * Upper bound for a single guarded blob passed to the credential scanner.
     * A larger blob is rejected instead of being truncated (fail closed).
     */
    private static final int MAX_GUARDED_BLOB_BYTES = 8 * 1024 * 1024;
    private static final Pattern WORKSPACE_DIR_PATTERN =
        Pattern.compile("^[0-9a-f]{8}-.+");
    private static final List<String> TEMP_DIR_PREFIXES = List.of(
        "opencode-harness-", "vibecode-askpass-");

    private Path repoDir;
    private String workspaceKey;
    private final String gitBinary;
    private final boolean dryRun;
    private final GitHubTokenSource tokenSource;
    private final Set<String> redactionTokens = new LinkedHashSet<>();
    private final Path credentialHelperScript;
    private final String repoCloneDir;
    private final Path cloneRoot;
    private final String repoName;
    private final String allowedTokenOrigin;
    private final boolean tokenOriginConfigured;
    private String localRepoRoot;
    private boolean localRootConfigured;
    private String localSourcePath;
    private String trustedGitConfig;
    private String baseCommit;
    /** The committer identity the supervisor writes; only these commits are replaceable. */
    static final String AGENT_COMMIT_EMAIL = "agent@vibecode.ai";

    private String guardedTree;
    private Path supervisorIndex;
    private Path askPassDirectory;
    private Path askPassScript;

    /**
     * Legacy constructors without a token origin. They keep the pre-D16
     * unrestricted token behaviour and are for tests/direct construction only;
     * production wiring must use the origin-aware constructor.
     *
     * @deprecated use the constructor that takes the provider token origin
     */
    @Deprecated
    public WorkspaceManager(String repoCloneDir, String repoName, boolean dryRun, String githubToken) {
        this(repoCloneDir, repoName, dryRun, githubToken, null, null, null);
    }

    /** @deprecated use the constructor that takes the provider token origin */
    @Deprecated
    public WorkspaceManager(
        String repoCloneDir, String repoName, boolean dryRun,
        String githubToken, GitHubTokenSource tokenSource) {
        this(repoCloneDir, repoName, dryRun, githubToken, tokenSource, null, null);
    }

    /** @deprecated use the constructor that takes the provider token origin */
    @Deprecated
    public WorkspaceManager(
        String repoCloneDir, String repoName, boolean dryRun,
        String githubToken, GitHubTokenSource tokenSource, String workspaceKey) {
        this(repoCloneDir, repoName, dryRun, githubToken, tokenSource, workspaceKey, null);
    }

    /**
     * @param tokenOrigin the only https origin allowed to receive the bearer
     *     token (the configured provider base/repo origin). Null keeps the
     *     legacy unrestricted behaviour for direct construction; production
     *     wiring always passes the configured origin.
     */
    public WorkspaceManager(
        String repoCloneDir, String repoName, boolean dryRun,
        String githubToken, GitHubTokenSource tokenSource, String workspaceKey,
        String tokenOrigin) {
        this.repoCloneDir = repoCloneDir;
        this.cloneRoot = Paths.get(repoCloneDir).toAbsolutePath().normalize();
        this.repoName = repoName;
        this.workspaceKey = workspaceKey;
        this.gitBinary = "git";
        this.dryRun = dryRun;
        this.tokenSource = tokenSource != null ? tokenSource : () -> githubToken;
        this.credentialHelperScript = null;
        this.repoDir = null;
        this.tokenOriginConfigured = tokenOrigin != null && !tokenOrigin.isBlank();
        this.allowedTokenOrigin = httpsOrigin(tokenOrigin);
    }

    /**
     * Confine filesystem clones to this root. Calling this (as production
     * wiring always does) makes a missing root fail closed; not calling it
     * keeps the legacy direct-construction behaviour for tests.
     */
    public void setLocalRepoRoot(String root) {
        this.localRootConfigured = true;
        this.localRepoRoot = root == null || root.isBlank() ? null : root.trim();
    }

    /** Set the ticket id (or other key) used for the runtime-scoped layout. */
    public void setWorkspaceKey(String workspaceKey) {
        if (workspaceKey != null && !workspaceKey.isBlank()) {
            safeKey(workspaceKey);
        }
        this.workspaceKey = workspaceKey;
    }

    private Path generateRepoDir() {
        String key = workspaceKey == null || workspaceKey.isBlank()
            ? UUID.randomUUID().toString().substring(0, 8) + "-" + sanitizePath(repoName)
            : safeKey(workspaceKey);
        return Paths.get(repoCloneDir, key, "repo").toAbsolutePath().normalize();
    }

    private String safeKey(String key) {
        String sanitized = sanitizePath(key);
        if (sanitized.isBlank() || sanitized.equals(".") || sanitized.equals("..")
                || key.contains("..") || key.contains("/") || key.contains("\\")) {
            throw new IllegalArgumentException("Invalid workspace key: " + key);
        }
        return sanitized;
    }

    /** Ticket workspace root {@code <runtimeRoot>/<ticketId>}. */
    public Path getWorkspaceRoot() {
        if (workspaceKey != null && !workspaceKey.isBlank()) {
            return Paths.get(repoCloneDir, safeKey(workspaceKey))
                .toAbsolutePath().normalize();
        }
        return repoDir == null ? null : repoDir.getParent();
    }

    /** Per-runtime cache directory, outside the ticket root. */
    public Path getCacheDir() {
        return cloneRoot.resolve("cache");
    }

    /** Write the active-run marker used by cleanup and host recovery guards. */
    public void writeActiveMarker(String runId) throws IOException {
        Path root = getWorkspaceRoot();
        if (root == null) {
            throw new IOException("No workspace root: workspaceKey/repoDir is unset");
        }
        Files.createDirectories(root);
        Path marker = root.resolve(".active");
        Files.writeString(marker, runId == null ? "" : runId, StandardCharsets.UTF_8);
        try {
            Files.setPosixFilePermissions(marker, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
            // Non-POSIX filesystem.
        }
    }

    /** Delete one ticket root (including its .active marker). */
    public void cleanup(String key) throws IOException {
        Path root = Paths.get(repoCloneDir, safeKey(key)).toAbsolutePath().normalize();
        cleanupPath(root);
    }

    /** Move the ticket workspace to the repository-level orphans/ directory. */
    public Path quarantine() throws IOException {
        Path root = getWorkspaceRoot();
        if (root == null || !Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return null;
        Path base = cloneRoot.getParent();
        if (base != null && "runtimes".equals(base.getFileName() == null
                ? "" : base.getFileName().toString())) {
            base = base.getParent();
        }
        Path orphans = (base == null ? cloneRoot : base).resolve("orphans");
        Files.createDirectories(orphans);
        Path target = orphans.resolve(root.getFileName() + "-" + Instant.now().toEpochMilli());
        try {
            Files.move(root, target);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(root, target);
        }
        return target;
    }

    /** Bytes under the ticket logs/ directory (0 when absent). */
    public long logsBytes() throws IOException {
        Path root = getWorkspaceRoot();
        if (root == null) return 0;
        Path logs = root.resolve("logs");
        if (!Files.isDirectory(logs, LinkOption.NOFOLLOW_LINKS)) return 0;
        final long[] total = {0};
        Files.walkFileTree(logs, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                total[0] += attrs.size();
                return FileVisitResult.CONTINUE;
            }
        });
        return total[0];
    }

    /** Delete the runtime root, including cache/. Refuses the configured base root. */
    public void cleanupRuntime() throws IOException {
        Path name = cloneRoot.getFileName();
        if (name == null || "repos".equals(name.toString())
                || cloneRoot.equals(cloneRoot.getRoot())) {
            throw new IOException("Refusing to delete the repository base root: " + cloneRoot);
        }
        cleanupPath(cloneRoot);
    }

    /** Delete only the shared runtime cache. */
    public void cleanupCache() throws IOException {
        cleanupPath(getCacheDir());
    }

    /** Bytes under the current ticket workspace. */
    public long workspaceBytes() throws IOException {
        return measureWorkspace(true);
    }

    /** True when the clone root is the runtime-scoped /repos/runtimes/<id>. */
    public boolean isRuntimeScoped() {
        Path parent = cloneRoot.getParent();
        return parent != null && "runtimes".equals(String.valueOf(parent.getFileName()));
    }

    /**
     * Bytes under the whole runtime root, including the shared cache. A legacy
     * /repos clone root is not a runtime, so this falls back to the ticket root
     * and never counts every workspace on the host.
     */
    public long runtimeBytes() throws IOException {
        return isRuntimeScoped() ? measureTree(cloneRoot, true) : measureWorkspace(true);
    }

    /** Inodes under the runtime root (ticket root for the legacy layout). */
    public long runtimeInodes() throws IOException {
        return isRuntimeScoped() ? measureTree(cloneRoot, false) : measureWorkspace(false);
    }

    /** Inode count under the current ticket workspace (bounded to regular files/dirs). */
    public long workspaceInodes() throws IOException {
        return measureWorkspace(false);
    }

    private long measureWorkspace(boolean bytes) throws IOException {
        return measureTree(getWorkspaceRoot(), bytes);
    }

    private long measureTree(Path root, boolean bytes) throws IOException {
        if (root == null || !Files.exists(root, LinkOption.NOFOLLOW_LINKS)) {
            return 0;
        }
        final long[] total = {0};
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (bytes) {
                    total[0] += attrs.size();
                } else {
                    total[0]++;
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                if (!bytes) {
                    total[0]++;
                }
                return FileVisitResult.CONTINUE;
            }
        });
        return total[0];
    }

    public Path getRepoDir() {
        return repoDir;
    }

    /** Base commit the run was cloned at, used for durable checkpoints. */
    public String getBaseCommit() {
        return baseCommit;
    }

    /**
     * Clone a repository to a unique workspace directory.
     */
    public void cloneRepo(String repoUrl, String branchName) throws IOException {
        cloneRepo(repoUrl, branchName, null, null);
    }

    public void cloneRepo(String repoUrl, String branchName, String baseBranch)
        throws IOException {
        cloneRepo(repoUrl, branchName, baseBranch, null);
    }

    /**
     * Clone and create the ticket branch from an explicit base branch. A null
     * or blank base branch keeps the legacy clone-HEAD behavior. A non-null
     * timeout bounds the network clone so a hung remote cannot hold the run.
     */
    public void cloneRepo(
        String repoUrl,
        String branchName,
        String baseBranch,
        Duration cloneTimeout
    ) throws IOException {
        prepareWorkspace();
        repoUrl = resolveLocalCloneUrl(repoUrl);
        log.info("Cloning repo from {} to {}", repoUrl, repoDir);
        if (dryRun) {
            log.info("[DRY RUN] Would clone {} to {}", repoUrl, repoDir);
            return;
        }
        cloneWithCredentials(repoUrl, cloneTimeout);
        createTicketBranch(branchName, baseBranch);

        // Pin the clone-time base commit before the harness starts. Every
        // subsequent read-tree/diff/tree/commit must use this SHA explicitly;
        // local HEAD, refs and replacement refs are agent-writable.
        this.baseCommit = runGitCommand("rev-parse", "HEAD");

        // Snapshot the supervisor-owned git config. The harness can modify
        // .git/config with bash, so publishing restores this snapshot first.
        captureTrustedGitConfig();

        log.info("Successfully cloned repo to {} and created branch {}", repoDir, branchName);
    }

    /**
     * Clone the repository and check out the existing PR branch pinned at
     * {@code reviewedSha} (fg-32c2c, FR5). No local branch is created for the
     * fix; the fast-forward publish later writes the same remote branch.
     *
     * <p>If the remote branch has moved past the reviewed commit the clone
     * fails with {@code reviewed_sha_mismatch} instead of fixing a stale base.
     * </p>
     */
    public void cloneExistingBranch(String repoUrl, String branchName, String reviewedSha)
        throws IOException {
        cloneExistingBranch(repoUrl, branchName, reviewedSha, null);
    }

    public void cloneExistingBranch(
        String repoUrl,
        String branchName,
        String reviewedSha,
        Duration cloneTimeout
    ) throws IOException {
        String branch = validateBranch(branchName);
        String expected = validateCommitSha(reviewedSha, "reviewed");
        prepareWorkspace();
        repoUrl = resolveLocalCloneUrl(repoUrl);
        log.info("Cloning repo from {} to {} on existing branch {}",
            repoUrl, repoDir, branch);
        if (dryRun) {
            log.info("[DRY RUN] Would clone {} and check out {}", repoUrl, branch);
            return;
        }

        cloneWithCredentials(repoUrl, cloneTimeout);

        // --quiet answers 1 for an absent ref while any other git failure is
        // thrown by runGitStatus, so "not present" is not blamed on corruption.
        String remoteRef = "refs/remotes/origin/" + branch;
        if (runGitStatus("rev-parse", "--verify", "--quiet", remoteRef) != 0) {
            throw new IOException(
                "reviewed_sha_mismatch: branch " + branch
                    + " is not present in the clone, reviewed " + expected);
        }
        String remoteSha = runGitCommand("rev-parse", "--verify", remoteRef).trim();
        if (!expected.equalsIgnoreCase(remoteSha)) {
            throw new IOException(
                "reviewed_sha_mismatch: " + branch + " is at " + remoteSha
                    + ", reviewed " + expected);
        }
        // Track the existing remote branch (no new branch is forked), then
        // pin HEAD to the exact reviewed commit.
        runGit("checkout", "-B", branch, "--track", "origin/" + branch);
        String head = runGitCommand("rev-parse", "HEAD").trim();
        if (!expected.equalsIgnoreCase(head)) {
            throw new IOException(
                "reviewed_sha_mismatch: HEAD is " + head + ", reviewed " + expected);
        }

        // The fix commit's parent and diff base is the reviewed SHA.
        this.baseCommit = expected;

        // Snapshot the supervisor-owned git config. The harness can modify
        // .git/config with bash, so publishing restores this snapshot first.
        captureTrustedGitConfig();
        log.info("Checked out existing branch {} at {}", branch, expected);
    }

    /** Create the workspace directory and clear a leftover from a failed run. */
    private void prepareWorkspace() throws IOException {
        this.repoDir = generateRepoDir();
        if (dryRun) {
            return;
        }
        Files.createDirectories(repoDir.getParent().resolve("tmp"));
        Files.createDirectories(repoDir.getParent().resolve("logs"));
        Files.createDirectories(getCacheDir());
        assertSafeToDelete(repoDir);

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
        Files.createDirectories(repoDir.getParent());
    }

    /**
     * Clone without authentication first (works for public repos) or with a
     * transient askpass helper for private repos. The token never appears in a
     * command line or in .git/config.
     */
    private void cloneWithCredentials(String repoUrl, Duration cloneTimeout)
        throws IOException {
        // Only HTTPS remotes can use the bearer token; file/absolute/SSH
        // repositories must not trigger a token fetch at all.
        boolean eligible = repoUrl.startsWith("https://") && shouldAuthenticate(repoUrl);
        String token = eligible ? currentToken() : null;
        boolean authenticate = token != null && !token.isBlank();
        if (authenticate) {
            ensureAskPass(token);
        }
        try {
            try {
                runGitClone(repoUrl, cloneTimeout);
            } catch (IOException first) {
                if (!authenticate || !isAuthenticationFailure(first.getMessage())) {
                    throw new IOException("Git clone failed: " + redact(first.getMessage()), first);
                }
                String refreshed = refreshToken(first);
                cleanupAskPass();
                removePartialClone();
                ensureAskPass(refreshed);
                try {
                    runGitClone(repoUrl, cloneTimeout);
                } catch (IOException second) {
                    throw new IOException(
                        "Git clone failed after credential refresh: "
                            + redact(second.getMessage()), second);
                }
            }
        } finally {
            cleanupAskPass();
        }
    }

    /**
     * Create the ticket branch for a build run. An explicit profile base branch
     * must resolve as a remote-tracking ref; failing closed is safer than
     * silently branching from the clone default.
     */
    private void createTicketBranch(String branchName, String baseBranch) throws IOException {
        String checkoutBase = baseBranch == null ? null : baseBranch.trim();
        if (checkoutBase != null && !checkoutBase.isEmpty()) {
            if (checkoutBase.startsWith("-") || checkoutBase.contains("..")) {
                throw new IOException("Invalid base branch: " + baseBranch);
            }
            runGit("rev-parse", "--verify", "origin/" + checkoutBase);
            runGit("checkout", "-b", branchName, "origin/" + checkoutBase);
        } else {
            runGit("checkout", "-b", branchName);
        }
    }

    /**
     * Stage every change, commit and push. Publishing always restores the
     * trusted git config and runs git with hooks disabled, and never discards
     * a commit the agent did not author (see {@link #publishBuildCommit}).
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

    /**
     * Commit the guarded tree without pushing (fg-32c2c3b3b).
     *
     * <p>Fix mode must not use {@link #commitAndPushStaged}: that pushes with a
     * lease derived from the current remote head, which would overwrite a human
     * push during the fix. This commits exactly the tree produced by
     * {@link #stageFreshDiff()} on top of the pinned base and leaves publishing
     * to {@link #publishFastForward}.</p>
     *
     * @return the full commit object id
     */
    public String commitStaged(String message) throws IOException {
        if (message == null || message.isBlank()) {
            throw new IOException("A commit message is required");
        }
        if (dryRun) {
            log.info("[DRY RUN] Would commit the staged tree: {}", message);
            return "dry-run-sha";
        }
        if (guardedTree == null) {
            throw new IOException("No guarded tree is staged");
        }
        hardenGitRepository();
        // commit-tree does not read the index, so a leftover agent-controlled
        // index cannot change what is committed.
        runGit("config", "user.email", AGENT_COMMIT_EMAIL);
        runGit("config", "user.name", "Vibecode Agent");
        return runGitWithIndex(
            "commit-tree", guardedTree, "-p", baseCommitOrHead(), "-m", message).strip();
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

        boolean stagedHere = false;
        try {
            if (guardedTree == null && stageFirst) {
                // Legacy path: still use a pinned base + exact tree rather than
                // trusting local HEAD or the agent-controlled index. Mark the
                // staged state first so a partial failure still cleans up.
                stagedHere = true;
                stageFreshDiff();
            }

            // Configure git identity after hardening/staging (both restore the
            // clone-time config, which must not carry an agent identity).
            runGit("config", "user.email", AGENT_COMMIT_EMAIL);
            runGit("config", "user.name", "Vibecode Agent");

            String commitSha;
            if (guardedTree != null) {
                // Publish the exact tree that was guarded. It is pinned at
                // staging time, so a mutated index or worktree cannot change
                // the commit.
                commitSha = runGitWithIndex(
                    "commit-tree", guardedTree, "-p", baseCommitOrHead(), "-m", message).strip();
            } else {
                // --no-verify is redundant with core.hooksPath=/dev/null, but
                // keeps the invariant obvious if an option is ever removed.
                runGit("commit", "--no-verify", "-m", message);
                commitSha = getCommitSha();
            }

            pushCommit(commitSha, branchName);
            return commitSha;
        } finally {
            if (stagedHere) {
                discardStaged();
            }
        }
    }

    private void pushCommit(String commitSha, String branchName) throws IOException {
        boolean eligible = httpsPublishingRemote();
        String token = eligible ? currentToken() : null;
        boolean authenticate = token != null && !token.isBlank();
        if (authenticate) {
            ensureAskPass(token);
        }
        try {
            try {
                publishBuildCommit(commitSha, branchName);
            } catch (IOException first) {
                if (!authenticate || !isAuthenticationFailure(first.getMessage())) {
                    throw first;
                }
                String refreshed = refreshToken(first);
                cleanupAskPass();
                ensureAskPass(refreshed);
                publishBuildCommit(commitSha, branchName);
            }
        } finally {
            cleanupAskPass();
        }
    }

    /**
     * Publish a build commit with fast-forward semantics (fg-32c2c3c).
     *
     * <p>A new branch is created without force. An existing branch is only
     * fast-forwarded, except when every commit it has on top of our base was
     * authored and committed by this agent: that is a previous attempt of ours,
     * which a retry may replace with a lease pinned to the head we just read.
     * A human commit in that range aborts with {@code remote_head_moved} — the
     * fresh lease read used before this change would have overwritten it.</p>
     */
    private void publishBuildCommit(String commitSha, String branchName) throws IOException {
        String advertised = remoteBranchSha("origin", branchName);
        if (advertised == null) {
            // The push itself creates the branch; never force a creation.
            pushFastForwardOnce(commitSha, branchName);
            return;
        }
        fetchRemoteBranch(branchName);
        String remote = remoteBranchRef(branchName);
        if (commitSha.equalsIgnoreCase(remote)) {
            return;
        }
        if (isAncestor(remote, commitSha)) {
            pushFastForwardOnce(commitSha, branchName);
            return;
        }
        if (!isAgentOwnedSince(remote)) {
            throw new IOException(
                "remote_head_moved: " + branchName + " is at " + remote
                    + " and contains commits this agent did not author; "
                    + "refusing to overwrite them");
        }
        pushWithLease(commitSha, branchName, remote);
    }

    private boolean isAncestor(String ancestor, String commitSha) throws IOException {
        return runGitStatus("merge-base", "--is-ancestor", ancestor, commitSha) == 0;
    }

    /**
     * True when every commit the remote has above our base carries the agent
     * identity as author and committer. Ownership is a heuristic, not a
     * security boundary: it only decides whether a retry may replace the
     * branch or a human wins.
     */
    private boolean isAgentOwnedSince(String remoteSha) throws IOException {
        String output;
        try {
            // Author and committer on separate lines; a human editing the
            // branch changes at least one of them.
            output = runGitCommand(
                "log", "--format=%ae%n%ce", baseCommitOrHead() + ".." + remoteSha).strip();
        } catch (IOException error) {
            return false;
        }
        if (output.isBlank()) {
            return false;
        }
        for (String line : output.split("\\R")) {
            if (!line.isBlank() && !AGENT_COMMIT_EMAIL.equalsIgnoreCase(line.trim())) {
                return false;
            }
        }
        return true;
    }

    /**
     * Publish a fix commit with fast-forward semantics only (fg-32c1).
     *
     * <p>The remote branch must still point at {@code reviewedSha} and
     * {@code commitSha} must descend from it. The fetches and the push share the
     * same transient askpass credentials as a clone, so authenticated remotes
     * work; without a credential, git fails closed instead of prompting. The
     * push is not forced, so a human push during the fix wins.</p>
     *
     * <p>A failure after the push is ambiguous: the commit may already be on the
     * remote. Those errors carry the {@code possibly_published} marker, and a
     * retry is safe because an already-published commit is not pushed again.
     * A push failure whose head cannot be re-read is treated the same way,
     * except that an authentication failure on the re-read is surfaced as
     * itself so the credential refresh can retry.</p>
     *
     * @return the full commit object id that was published; in dry-run, the
     *     resolved id when a workspace exists, otherwise the supplied value
     */
    public String publishFastForward(
        String commitSha,
        String branchName,
        String reviewedSha
    ) throws IOException {
        String branch = validateBranch(branchName);
        String expected = validateCommitSha(reviewedSha, "reviewed");
        if (commitSha == null || commitSha.isBlank()) {
            throw new IOException("A commit SHA is required");
        }
        if (dryRun) {
            // Keep the return shape identical to a real publish when the
            // workspace exists; a dry run has no clone to resolve against.
            String resolved = hasGitWorkspace() ? resolveCommit(commitSha) : commitSha.trim();
            log.info("[DRY RUN] Would fast-forward publish {} to {}", resolved, branch);
            return resolved;
        }

        hardenGitRepository();
        // Resolve a short or ref name to the full object id so the comparison
        // against the remote head below compares like with like.
        String commit = resolveCommit(commitSha);

        runWithCredentials(() -> {
            publishOnce(branch, expected, commit);
            verifyPublished(branch, commit);
        });
        return commit;
    }

    /**
     * Fetch, confirm the remote is still at the reviewed SHA, confirm the fix
     * descends from it, then push without force. Re-running it after an
     * ambiguous push success is a no-op rather than a second push.
     */
    private void publishOnce(String branch, String expected, String commit) throws IOException {
        fetchRemoteBranch(branch);
        String remoteSha = remoteBranchRef(branch);
        // Local and network-free, so it also guards the already-published and
        // moved-head paths: rewritten history must never pass as a fix.
        requireFastForward(expected, commit);
        if (commit.equalsIgnoreCase(remoteSha)) {
            return;
        }
        if (!expected.equalsIgnoreCase(remoteSha)) {
            throw new IOException(
                "remote_head_moved: " + branch + " is at " + remoteSha
                    + ", reviewed " + expected);
        }
        try {
            pushFastForwardOnce(commit, branch);
        } catch (IOException pushFailure) {
            // A human push can land between the fetch above and the push. Git
            // reports that as a raw non-fast-forward rejection; re-read the
            // head so callers get the same remote_head_moved signal as the
            // pre-push check.
            String current;
            try {
                fetchRemoteBranch(branch);
                current = remoteBranchRef(branch);
            } catch (IOException reReadFailure) {
                if (isAuthenticationFailure(reReadFailure.getMessage())) {
                    // Let the outer credential refresh retry the whole step:
                    // swallowing it here would hide the cause.
                    throw reReadFailure;
                }
                // The push may have been applied before the connection dropped.
                throw new IOException(
                    "possibly_published: the push of " + commit + " to " + branch
                        + " failed and the remote head could not be re-read: "
                        + pushFailure.getMessage(), pushFailure);
            }
            if (commit.equalsIgnoreCase(current)) {
                return;
            }
            if (!expected.equalsIgnoreCase(current)) {
                throw new IOException(
                    "remote_head_moved: " + branch + " is at " + current
                        + ", reviewed " + expected, pushFailure);
            }
            // The remote is unchanged, so the rejected push published nothing.
            throw pushFailure;
        }
    }

    private String resolveCommit(String commitSha) throws IOException {
        return runGitCommand("rev-parse", "--verify", commitSha.trim() + "^{commit}").trim();
    }

    private boolean hasGitWorkspace() {
        Path gitDir = repoDir == null ? null : repoDir.resolve(".git");
        return gitDir != null && Files.isDirectory(gitDir, LinkOption.NOFOLLOW_LINKS)
            && !Files.isSymbolicLink(gitDir);
    }

    /**
     * A non-force push is not enough on a remote without fast-forward
     * protection, so the ancestry check enforces the same rule locally.
     */
    private void requireFastForward(String reviewedSha, String commitSha) throws IOException {
        // merge-base answers "no" with exit 1; any other non-zero code is a
        // real failure, not a verdict about ancestry.
        if (!isAncestor(reviewedSha, commitSha)) {
            throw new IOException(
                "not_fast_forward: " + commitSha + " does not descend from reviewed "
                    + reviewedSha);
        }
    }

    /**
     * Run git and return 0 or 1. Exit codes above 1 are errors, not answers, so
     * they throw with the redacted output instead of being mislabelled.
     */
    private int runGitStatus(String... args) throws IOException {
        Process process = startGit(repoDir, Map.of(), args);
        String output = readProcessOutput(process);
        int exitCode;
        try {
            exitCode = process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Git command interrupted: " + e.getMessage());
        }
        if (exitCode > 1) {
            throw new IOException(
                "git " + redact(String.join(" ", args)) + " failed: " + redact(output));
        }
        return exitCode;
    }

    private void verifyPublished(String branch, String commit) throws IOException {
        String published;
        try {
            fetchRemoteBranch(branch);
            published = remoteBranchRef(branch);
        } catch (IOException failure) {
            throw new IOException(
                "possibly_published: pushed " + commit + " to " + branch
                    + " but the remote head could not be verified: "
                    + failure.getMessage(), failure);
        }
        if (!commit.equalsIgnoreCase(published)) {
            throw new IOException(
                "remote_head_mismatch: possibly_published " + commit + ", but "
                    + branch + " is at " + published);
        }
    }

    private void fetchRemoteBranch(String branch) throws IOException {
        runGit("fetch", "--no-tags", "origin",
            "+refs/heads/" + branch + ":" + FETCHED_REF_PREFIX + branch);
    }

    private String remoteBranchRef(String branch) throws IOException {
        return runGitCommand("rev-parse", "--verify", FETCHED_REF_PREFIX + branch).trim();
    }

    /**
     * Run an authenticated git operation, refreshing the credential once when
     * git reports an authentication failure. The askpass script must cover
     * every step, fetches included: without it git runs with
     * {@code GIT_ASKPASS=/dev/null} and fails on a private remote.
     */
    private void runWithCredentials(GitOperation operation) throws IOException {
        boolean eligible = httpsPublishingRemote();
        String token = eligible ? currentToken() : null;
        boolean authenticate = token != null && !token.isBlank();
        if (authenticate) {
            ensureAskPass(token);
        }
        try {
            try {
                operation.run();
            } catch (IOException first) {
                if (!authenticate || !isAuthenticationFailure(first.getMessage())) {
                    throw first;
                }
                String refreshed = refreshToken(first);
                cleanupAskPass();
                ensureAskPass(refreshed);
                operation.run();
            }
        } finally {
            cleanupAskPass();
        }
    }

    private void pushFastForwardOnce(String commitSha, String branchName) throws IOException {
        runGit("push", "--no-verify", "origin",
            commitSha + ":refs/heads/" + branchName);
    }

    /**
     * Approximates {@code git check-ref-format --branch} without needing a
     * workspace. Anything this accepts but git rejects still fails closed at
     * fetch time, and the branch name is only used as an explicit refspec.
     */
    private static String validateBranch(String branchName) throws IOException {
        String branch = branchName == null ? "" : branchName.trim();
        boolean invalid = branch.isEmpty()
            || branch.startsWith("-")
            || branch.startsWith("/")
            || branch.endsWith("/")
            || branch.endsWith(".")
            || branch.contains("..")
            || branch.contains("//")
            || branch.contains("@{")
            || branch.endsWith(".lock")
            || branch.chars().anyMatch(c -> c <= ' ' || "\u007f~^:?*[\\".indexOf(c) >= 0);
        if (invalid) {
            throw new IOException("A valid branch name is required");
        }
        return branch;
    }

    private static String validateCommitSha(String sha, String label) throws IOException {
        String value = sha == null ? "" : sha.trim().toLowerCase(Locale.ROOT);
        if (!value.matches("[0-9a-f]{40}|[0-9a-f]{64}")) {
            throw new IOException(label + " SHA must be a full commit object id");
        }
        return value;
    }

    @FunctionalInterface
    private interface GitOperation {
        void run() throws IOException;
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
        // Reset the agent-controlled index to the pinned base before staging.
        // This drops index-only cache entries and clears
        // assume-unchanged/skip-worktree flags so `git add -A` sees the real
        // worktree.
        runGit("read-tree", baseCommitOrHead());
        runGit("add", "-A");
    }

    /**
     * Content/tree fingerprint of the worktree built through a temporary index.
     *
     * <p>This is the same shape {@link #stageFreshDiff()} publishes: read the
     * pinned base, {@code add -A} and {@code write-tree}. A porcelain status
     * string cannot detect a cleanup that changes the content of an already
     * dirty file, and it ignores untracked files that publishing would stage.
     * The temporary index also ignores the agent-controlled index flags
     * (assume-unchanged/skip-worktree). Ignored test data is not added, which
     * matches what publishing would exclude.</p>
     */
    public String worktreeTreeId() throws IOException {
        if (repoDir == null || !Files.exists(repoDir)) {
            return "";
        }
        hardenGitRepository();
        String base = baseCommitOrHead();
        Path index = Files.createTempFile("vibecode-worktree-tree-", ".idx");
        Files.deleteIfExists(index);
        try {
            String indexEnv = index.toString();
            runGitAt(repoDir, Map.of("GIT_INDEX_FILE", indexEnv), "read-tree", base);
            runGitAt(repoDir, Map.of("GIT_INDEX_FILE", indexEnv), "add", "-A");
            return runGitAt(repoDir, Map.of("GIT_INDEX_FILE", indexEnv), "write-tree").trim();
        } finally {
            Files.deleteIfExists(index);
        }
    }

    /**
     * Build a supervisor-owned index from the pinned base commit (falling back
     * to HEAD only when no base commit was pinned), apply the worktree on top
     * of it, and return a diff computed from index blobs.
     *
     * <p>This deliberately ignores the agent-controlled {@code .git/index}:
     * {@code assume-unchanged}, {@code skip-worktree} and index-only cache
     * entries cannot influence what is guarded or published.</p>
     */
    public DiffSummary stageFreshDiff() throws IOException {
        if (dryRun) {
            return DiffSummary.empty();
        }
        if (repoDir == null || !Files.exists(repoDir)) {
            throw new IOException("Workspace is not initialized");
        }
        hardenGitRepository();
        discardStaged();
        String base = baseCommitOrHead();

        // The object store is agent-writable. Verify integrity and ignore
        // replacement refs before reading the base tree. HARNESS_FSCK=false/0
        // is available for very large repositories where the full scan is too
        // expensive; it trades integrity checking for throughput.
        checkObjectIntegrity(System.getenv("HARNESS_FSCK"));
        Path index = Files.createTempFile("vibecode-harness-index-", ".idx");
        Files.deleteIfExists(index);
        this.supervisorIndex = index;

        runGitWithIndex("read-tree", base);
        runGitWithIndex("add", "-A");

        // Bind the guard to this exact tree. Publishing must use this SHA, not
        // a second write-tree that a surviving process could influence.
        this.guardedTree = runGitWithIndex("write-tree");
        return diffFromTree(base, guardedTree);
    }

    /**
     * Return the added/modified blobs from the guarded tree for output
     * scanning. Reading the tree blobs directly avoids diff-format bypasses:
     * a {@code .gitattributes} rule such as {@code * -diff}, a binary file,
     * a {@code ++}-prefixed line, or a secret used as a filename cannot hide
     * content from this method.
     *
     * <p>This must be called after {@link #stageFreshDiff()} and before
     * {@link #discardStaged()}. Deleted files are skipped because their
     * content cannot be published.</p>
     */
    public List<GuardedBlob> guardedChangedBlobs() throws IOException {
        if (supervisorIndex == null || guardedTree == null) {
            throw new IOException("No guarded tree is staged");
        }
        String base = baseCommitOrHead();
        String changed = new String(
            runGitBytes(
                MAX_GUARDED_BLOB_BYTES,
                "diff-tree", "-r", "-z", "--no-renames", "--raw", base, guardedTree),
            StandardCharsets.UTF_8);
        String[] tokens = changed.split("\u0000", -1);
        List<GuardedBlob> blobs = new ArrayList<>();
        for (int i = 0; i + 1 < tokens.length; i += 2) {
            String meta = tokens[i];
            String path = tokens[i + 1];
            String[] parts = meta.split(" ");
            if (parts.length < 5) {
                throw new IOException("Unexpected git diff-tree record for " + path);
            }
            String newMode = parts[1];
            String status = parts[4];
            if (path.isBlank() || status.startsWith("D")) {
                continue;
            }
            String oldMode = parts[0].startsWith(":") ? parts[0].substring(1) : parts[0];
            boolean newPath = status.startsWith("A");
            // A gitlink points at a commit, not blob content. It cannot carry
            // a credential in its content, but a newly added gitlink path can
            // still contain one, so expose it as a path-only blob.
            if ("160000".equals(newMode)) {
                if (newPath) {
                    blobs.add(new GuardedBlob(path, new byte[0], new byte[0], true));
                }
                continue;
            }
            byte[] content = runGitBytes(
                MAX_GUARDED_BLOB_BYTES,
                "cat-file", "blob", guardedTree + ":" + path);
            // A gitlink -> regular-file type change has no blob in the base;
            // treat it like a new-content file for comparison purposes.
            byte[] baseContent = newPath || "160000".equals(oldMode)
                ? new byte[0]
                : runGitBytes(
                    MAX_GUARDED_BLOB_BYTES,
                    "cat-file", "blob", base + ":" + path);
            blobs.add(new GuardedBlob(path, content, baseContent, newPath));
        }
        return List.copyOf(blobs);
    }

    /**
     * A changed file from the guarded tree. {@code baseContent} is the blob
     * from the base commit (empty for a new file), and {@code newPath} marks a
     * file that did not exist in the base. The content arrays are copies, so
     * the scanner cannot observe or mutate the tree object.
     */
    public record GuardedBlob(
        String path,
        byte[] content,
        byte[] baseContent,
        boolean newPath
    ) {
        public GuardedBlob {
            path = path == null ? "" : path;
            content = content == null ? new byte[0] : content.clone();
            baseContent = baseContent == null ? new byte[0] : baseContent.clone();
        }

        @Override
        public byte[] content() {
            return content.clone();
        }

        @Override
        public byte[] baseContent() {
            return baseContent.clone();
        }
    }

    public void discardStaged() {
        Path index = supervisorIndex;
        supervisorIndex = null;
        guardedTree = null;
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
     * Write multiple files to the workspace for in-process helpers; the harness
     * edits the workspace directly.
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
        String requested = fileOp.getPath() == null ? "" : fileOp.getPath().replace('\\', '/');
        if (isLegacyProtectedPath(requested)) {
            throw new IOException("Refusing to write protected path: " + fileOp.getPath());
        }
        Path root = repoDir.toRealPath();
        Path targetPath = root.resolve(fileOp.getPath()).normalize();
        if (!targetPath.startsWith(root)) {
            throw new IOException("Refusing to write outside the workspace: " + fileOp.getPath());
        }

        Path parent = targetPath.getParent();
        Path realParent = resolveRealParent(parent, root);
        Path realTarget = Files.exists(targetPath, LinkOption.NOFOLLOW_LINKS)
            ? targetPath.toRealPath()
            : realParent.resolve(targetPath.getFileName()).normalize();
        if (!realTarget.startsWith(root)
            || isLegacyProtectedPath(root.relativize(realTarget).toString())) {
            throw new IOException("Refusing to write protected path: " + fileOp.getPath());
        }

        switch (fileOp.getAction()) {
            case CREATE:
            case MODIFY:
                if (Files.isSymbolicLink(targetPath)) {
                    throw new IOException("Refusing to write through symlink: " + fileOp.getPath());
                }
                Files.createDirectories(parent);
                Path realParentAfter = parent.toRealPath();
                if (!realParentAfter.startsWith(root)) {
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
     * The legacy AI path must not be able to rewrite git metadata or CI
     * configuration. The harness path is additionally guarded before publish.
     */
    private static boolean isLegacyProtectedPath(String path) {
        String value = path.trim().replace('\\', '/');
        while (value.startsWith("./")) {
            value = value.substring(2);
        }
        if (value.isEmpty() || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            return true;
        }
        String lower = value.toLowerCase();
        if (lower.equals(".git") || lower.startsWith(".git/") || lower.contains("/.git/")) {
            return true;
        }
        if (lower.equals(".github") || lower.endsWith("/.github")
            || lower.startsWith(".github/") || lower.contains("/.github/")
            || lower.equals(".gitlab-ci.yml") || lower.startsWith(".circleci/")
            || lower.equals("azure-pipelines.yml") || lower.equals("jenkinsfile")
            || lower.endsWith("/jenkinsfile")) {
            return true;
        }
        if (lower.equals("secrets") || lower.endsWith("/secrets")
            || lower.startsWith("secrets/") || lower.contains("/secrets/")) {
            return true;
        }
        String name = lower.substring(lower.lastIndexOf('/') + 1);
        if (name.equals(".env") || (name.startsWith(".env.") && !name.endsWith(".env.example"))) {
            return true;
        }
        return false;
    }

    /**
     * Resolve the nearest existing ancestor and append the non-existent
     * remainder. A cloned repo may contain a symlinked directory; the returned
     * path reflects where a write would actually land, without creating any
     * directories yet.
     */
    private static Path resolveRealParent(Path parent, Path root) throws IOException {
        Path current = parent;
        Path suffix = Path.of("");
        while (current != null && !Files.exists(current, LinkOption.NOFOLLOW_LINKS)) {
            Path name = current.getFileName();
            if (name != null) {
                suffix = name.resolve(suffix);
            }
            current = current.getParent();
        }
        if (current == null) {
            throw new IOException("Cannot resolve workspace parent: " + parent);
        }
        Path real = current.toRealPath();
        if (!real.startsWith(root)) {
            throw new IOException("Refusing to write outside the workspace: " + parent);
        }
        return real.resolve(suffix).normalize();
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

    /**
     * Run a git command and return raw bytes (for blob content scanning).
     * Output larger than {@code maxBytes} is rejected rather than truncated.
     */
    private byte[] runGitBytes(int maxBytes, String... args) throws IOException {
        if (repoDir == null) {
            throw new IOException("Workspace has not been cloned");
        }
        Process process = startGit(repoDir, Map.of(), args);
        byte[] output;
        try (InputStream input = process.getInputStream()) {
            output = input.readNBytes(maxBytes + 1);
        }
        if (output.length > maxBytes) {
            process.destroyForcibly();
            waitFor(process);
            throw new IllegalStateException(
                "Changed blob exceeds the " + maxBytes + "-byte scan limit");
        }
        int exitCode = waitFor(process);
        if (exitCode != 0) {
            throw new IOException("git " + redact(String.join(" ", args))
                + " failed with exit code " + exitCode);
        }
        return output;
    }

    private String runGitWithIndex(String... args) throws IOException {
        if (supervisorIndex == null) {
            throw new IOException("No supervisor index is active");
        }
        return runGitAt(repoDir, Map.of("GIT_INDEX_FILE", supervisorIndex.toString()), args);
    }

    private String runGitClone(String repoUrl, Duration cloneTimeout) throws IOException {
        if (cloneTimeout == null || cloneTimeout.isZero() || cloneTimeout.isNegative()) {
            return runGitAt(repoDir.getParent(), Map.of(), "clone", repoUrl, repoDir.toString());
        }
        return runGitAtWithTimeout(
            repoDir.getParent(), Map.of(), cloneTimeout,
            "clone", repoUrl, repoDir.toString());
    }

    private String runGitAtWithTimeout(
        Path directory,
        Map<String, String> extraEnvironment,
        Duration timeout,
        String... args
    ) throws IOException {
        Process process = startGit(directory, extraEnvironment, args);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        Thread reader = new Thread(() -> {
            try (InputStream input = process.getInputStream()) {
                input.transferTo(output);
            } catch (IOException ignored) {
                // The process result below carries the failure.
            }
        }, "git-clone-output");
        reader.setDaemon(true);
        reader.start();
        boolean finished;
        try {
            finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            ProcessGroup.kill(process);
            throw new IOException("Git command interrupted", e);
        }
        if (!finished) {
            ProcessGroup.kill(process);
            process.destroyForcibly();
            try {
                reader.join(1_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            throw new IOException("git " + redact(String.join(" ", args))
                + " timed out after " + timeout.toSeconds() + "s");
        }
        try {
            reader.join(5_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Git output reader interrupted", e);
        }
        String text = output.toString(StandardCharsets.UTF_8);
        if (process.exitValue() != 0) {
            throw new IOException("git " + redact(String.join(" ", args))
                + " failed: " + redact(text));
        }
        return text.stripTrailing();
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
        command.addAll(gitOptions(localSourcePath));
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
        environment.put("GIT_NO_REPLACE_OBJECTS", "1");
        environment.put("GIT_ASKPASS",
            askPassScript != null ? askPassScript.toString() : devNull());
        if (extraEnvironment != null) {
            environment.putAll(extraEnvironment);
        }
    }

    void checkObjectIntegrity(String value) throws IOException {
        if (fsckEnabled(value)) {
            runGit("fsck", "--strict", "--no-progress", "--no-reflogs");
        } else {
            log.warn("HARNESS_FSCK=false/0: skipping git object-integrity checks for {}; "
                + "use only for trusted, very large repositories", repoDir);
        }
    }

    /**
     * Supervisor git options. A local source owned by another user (the API)
     * is trusted for this workspace only; the path was already confined to
     * the configured root.
     */
    static List<String> gitOptions(String localSourcePath) {
        List<String> options = new ArrayList<>(SAFE_GIT_OPTIONS);
        if (localSourcePath != null && !localSourcePath.isBlank()) {
            options.add("-c");
            options.add("safe.directory=" + localSourcePath);
        }
        return options;
    }

    static boolean fsckEnabled(String value) {
        return value == null || value.isBlank()
            || !("false".equalsIgnoreCase(value.trim()) || "0".equals(value.trim()));
    }

    private static String devNull() {
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "NUL" : "/dev/null";
    }

    /**
     * Create a short-lived GIT_ASKPASS helper. The token is kept out of argv
     * (visible in {@code ps}) and out of .git/config; the script is deleted as
     * soon as the clone/push finishes.
     */
    private void ensureAskPass(String rawToken) throws IOException {
        if (askPassScript != null && Files.isRegularFile(askPassScript)) {
            return;
        }
        cleanupAskPass();
        askPassDirectory = Files.createTempDirectory("vibecode-askpass-");
        askPassScript = askPassDirectory.resolve("askpass.sh");
        String script = askPassScript(rawToken, authorityOf(allowedTokenOrigin));
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

    /**
     * Askpass helper. When an origin is configured, the prompt must mention its
     * host before any credential is returned, so a redirected remote cannot
     * harvest the token even if git follows it.
     */
    static String askPassScript(String rawToken, String allowedAuthority) {
        String token = shellSingleQuote(rawToken == null ? "" : rawToken);
        StringBuilder script = new StringBuilder("#!/bin/sh\n");
        if (allowedAuthority != null && !allowedAuthority.isBlank()) {
            // Case-insensitive shell patterns, built from character classes so
            // the helper stays a POSIX-sh script with no external commands.
            String authorityPattern = caseInsensitivePattern(allowedAuthority);
            String allowed = authorityPattern;
            // A colon inside an IPv6 literal is not a port separator.
            boolean hasPort;
            if (allowedAuthority.startsWith("[")) {
                int close = allowedAuthority.indexOf(']');
                hasPort = close >= 0 && close + 1 < allowedAuthority.length()
                    && allowedAuthority.charAt(close + 1) == ':';
            } else {
                hasPort = allowedAuthority.contains(":");
            }
            if (!hasPort) {
                // Only the default port is additionally valid when none was
                // configured explicitly.
                allowed += "|" + authorityPattern + ":443";
            }
            script.append("case \"$1\" in\n")
                .append("  *\"'\"*\"'\"*) url=${1#*\\'}; url=${url%%\\'*} ;;\n")
                .append("  *) exit 1 ;;\n")
                .append("esac\n")
                .append("case \"$url\" in\n")
                .append("  */) url=${url%/} ;;\n")
                .append("esac\n")
                // Git's password prompt repeats the username it just received
                // (https://oauth2@host). Strip only authority userinfo; a path
                // or query is not a valid auth prompt and is rejected.
                .append("case \"$url\" in\n")
                .append("  [hH][tT][tT][pP][sS]://*/*) exit 1 ;;\n")
                .append("  [hH][tT][tT][pP][sS]://*)\n")
                .append("    authority=${url#*://}\n")
                .append("    authority=${authority##*@}\n")
                .append("    ;;\n")
                .append("  *) exit 1 ;;\n")
                .append("esac\n")
                .append("case \"$authority\" in\n")
                .append("  ").append(allowed).append(") ;;\n")
                .append("  *) exit 1 ;;\n")
                .append("esac\n");
        }
        return script
            .append("case \"$1\" in\n")
            .append("  *Username*) printf '%s\\n' 'oauth2' ;;\n")
            .append("  *) printf '%s\\n' ").append(token).append(" ;;\n")
            .append("esac\n")
            .toString();
    }

    /**
     * Build a shell case pattern that matches the literal value
     * case-insensitively: letters become {@code [aA]} classes and every other
     * run is single-quoted. Uses only POSIX-sh pattern syntax.
     */
    static String caseInsensitivePattern(String value) {
        StringBuilder pattern = new StringBuilder();
        StringBuilder literal = new StringBuilder();
        for (char c : value.toCharArray()) {
            if (c < 128 && Character.isLetter(c)) {
                if (literal.length() > 0) {
                    pattern.append(shellSingleQuote(literal.toString()));
                    literal.setLength(0);
                }
                pattern.append('[')
                    .append(Character.toLowerCase(c))
                    .append(Character.toUpperCase(c))
                    .append(']');
            } else {
                literal.append(c);
            }
        }
        if (literal.length() > 0) {
            pattern.append(shellSingleQuote(literal.toString()));
        }
        return pattern.toString();
    }

    private static String authorityOf(String origin) {
        if (origin == null) {
            return null;
        }
        return origin.startsWith("https://") ? origin.substring("https://".length()) : null;
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

    private void removePartialClone() throws IOException {
        if (!Files.exists(repoDir, LinkOption.NOFOLLOW_LINKS)) {
            return;
        }
        assertSafeToDelete(repoDir);
        try {
            deletePath(repoDir);
        } catch (IOException error) {
            throw new IOException(
                "A failed clone left a destination that could not be removed: "
                    + repoDir, error);
        }
    }

    private void pushWithLease(
        String commitSha, String branchName, String expectedSha) throws IOException {
        String lease = "--force-with-lease=refs/heads/" + branchName + ":" + expectedSha;
        runGit("push", "--no-verify", "origin",
            commitSha + ":refs/heads/" + branchName, lease);
    }

    private String refreshToken(IOException failure) throws IOException {
        String refreshed;
        try {
            refreshed = tokenSource.refresh();
        } catch (IOException refreshFailure) {
            throw new IOException(
                "Git credential refresh failed: " + redact(refreshFailure.getMessage()),
                failure);
        }
        if (refreshed == null || refreshed.isBlank()) {
            throw new IOException("No GitHub credential is available after refresh", failure);
        }
        redactionTokens.add(refreshed);
        return refreshed;
    }

    static boolean isAuthenticationFailure(String message) {
        if (message == null) {
            return false;
        }
        String lower = message.toLowerCase(Locale.ROOT);
        return lower.contains("authentication failed")
            || lower.contains("could not read username")
            || lower.contains("invalid username or password")
            || lower.contains("http 401")
            || lower.contains("returned error: 401");
    }

    /**
     * Normalize an https URL to {@code scheme://host[:port]}, dropping any
     * credentials, path and query. Returns null for non-https URLs.
     */
    static String httpsOrigin(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) {
            return null;
        }
        try {
            URI uri = URI.create(rawUrl.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                return null;
            }
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            int port = uri.getPort();
            return port == -1 || port == 443
                ? "https://" + host
                : "https://" + host + ":" + port;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /**
     * Only send the bearer token to the configured provider origin. The token
     * is never sent over http, to an ssh/file remote, or to another host.
     */
    boolean shouldAuthenticate(String repoUrl) {
        if (!tokenOriginConfigured) {
            return true; // legacy direct construction; production always configures one
        }
        // A configured origin that does not normalize to https (http, ssh,
        // malformed) must fail closed instead of falling into the legacy path.
        String origin = httpsOrigin(repoUrl);
        return origin != null && origin.equals(allowedTokenOrigin);
    }

    /**
     * Validate a local source and return the URL actually cloned: the resolved
     * file URL for filesystem repositories, or the original URL otherwise.
     */
    private String resolveLocalCloneUrl(String repoUrl) throws IOException {
        boolean fileUrl = isFileUrl(repoUrl);
        boolean absolute;
        try {
            absolute = Paths.get(repoUrl).isAbsolute();
        } catch (RuntimeException e) {
            absolute = false;
        }
        if (!fileUrl && !absolute) {
            return repoUrl;
        }
        if (!localRootConfigured) {
            return repoUrl; // legacy direct construction/tests
        }
        if (localRepoRoot == null) {
            throw new IOException("Local repositories require GIT_LOCAL_ROOT");
        }
        Path root;
        try {
            root = Paths.get(localRepoRoot);
        } catch (RuntimeException e) {
            throw new IOException("GIT_LOCAL_ROOT is not a valid path", e);
        }
        if (!root.isAbsolute()) {
            throw new IOException("GIT_LOCAL_ROOT must be an absolute path");
        }
        Path repo;
        try {
            root = root.toRealPath();
            repo = localPath(repoUrl).toRealPath();
        } catch (IOException e) {
            throw new IOException("Local repository path does not exist", e);
        }
        if (!repo.startsWith(root)) {
            throw new IOException("Local repository is outside the configured root");
        }
        // Clone the resolved path so a symlink swap after the check is less
        // likely to redirect the clone. Remember it for safe.directory: the
        // source is often owned by the API user, not the agent user.
        this.localSourcePath = repo.toString();
        return repo.toUri().toString();
    }

    private static boolean isFileUrl(String repoUrl) {
        return repoUrl != null && repoUrl.regionMatches(true, 0, "file://", 0, 7);
    }

    private Path localPath(String repoUrl) throws IOException {
        if (!isFileUrl(repoUrl)) {
            return Paths.get(repoUrl);
        }
        URI uri;
        try {
            // URI/Path schemes are lowercase; a mixed-case input still points
            // at the same local path.
            uri = URI.create("file" + repoUrl.substring("file".length()));
        } catch (IllegalArgumentException e) {
            throw new IOException("Invalid local repository URL", e);
        }
        if (uri.getHost() != null && !uri.getHost().isBlank()
            && !"localhost".equalsIgnoreCase(uri.getHost())) {
            throw new IOException("Local file URL must not name a remote host");
        }
        try {
            return Paths.get(uri);
        } catch (RuntimeException e) {
            throw new IOException("Invalid local repository URL", e);
        }
    }

    /** Read the publishing remote's URL; a failure returns null. */
    private String remoteOriginUrl() {
        try {
            return runGitCommand("remote", "get-url", "origin").trim();
        } catch (IOException e) {
            log.debug("Could not read the origin URL: {}", e.getMessage());
            return null;
        }
    }

    /**
     * True only when the publishing remote is HTTPS and allowed to receive the
     * token. A file/ssh remote (or an unreadable one) never triggers a token
     * fetch.
     */
    boolean httpsPublishingRemote() {
        String remote = remoteOriginUrl();
        return remote != null && remote.startsWith("https://") && shouldAuthenticate(remote);
    }

    private String currentToken() throws IOException {
        String token = tokenSource.get();
        if (token != null && !token.isBlank()) {
            redactionTokens.add(token);
        }
        return token;
    }

    private String redact(String value) {
        if (value == null) {
            return "";
        }
        String redacted = value;
        for (String token : redactionTokens) {
            redacted = redacted.replace(token, "[REDACTED]");
        }
        return redacted;
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
        if (repoDir == null) {
            throw new IOException("Refusing to publish: no workspace has been cloned");
        }
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
        // Legacy graft files can rewrite history even with replace refs off.
        Files.deleteIfExists(gitDir.resolve("info/grafts"));
    }

    private String baseCommitOrHead() throws IOException {
        if (baseCommit != null && !baseCommit.isBlank()) {
            return baseCommit;
        }
        return runGitCommand("rev-parse", "HEAD");
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

    private DiffSummary diffFromTree(String base, String tree) throws IOException {
        String changed = runGitCommand(
            "diff-tree", "-r", "-z", "--no-renames", "--name-status", base, tree);
        Map<String, int[]> stats = parseNumstat(runGitCommand(
            "diff-tree", "-r", "-z", "--no-renames", "--numstat", base, tree));
        Map<String, String> newBlobs = treeBlobs(tree);
        Map<String, String> oldBlobs = treeBlobs(base);
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

            String oldSha = oldBlobs.get(path);
            String newSha = newBlobs.get(path);
            long oldSize = oldSha == null ? 0 : blobSize(oldSha);
            long newSize = newSha == null ? 0 : blobSize(newSha);
            int[] stat = stats.get(path);
            if (stat != null && stat[0] >= 0 && stat[1] >= 0) {
                additions += stat[0];
                deletions += stat[1];
            } else if ("deleted".equals(status)) {
                deletions += countBlobLines(oldSha);
            } else {
                // Binary or `-diff` attribute: fall back to the raw blob so a
                // hostile .gitattributes cannot hide a large text file.
                additions += countBlobLines(newSha);
                if (oldSha != null && !oldSha.equals(newSha)
                    && (oldSize > newSize || oldSize > MAX_COUNTED_BYTES)) {
                    // Without numstat we cannot isolate the removed lines, so
                    // count the old blob too when content was removed or the
                    // old blob is oversized. Otherwise a shrinking -diff text
                    // file bypasses HARNESS_MAX_LINES once the byte limit is
                    // raised. Small grows/same-size edits keep the new blob
                    // only, avoiding a full-old-blob false positive.
                    deletions += countBlobLines(oldSha);
                }
            }

            // changedBytes is added plus removed content, so removed content
            // cannot bypass HARNESS_MAX_BYTES through a delete or shrink.
            // Unchanged content is not double-counted: a grown file contributes
            // its new size, while a shrunk file contributes its new size plus
            // the removed delta.
            bytes += newSize;
            if ("deleted".equals(status)) {
                bytes += oldSize;
            } else if (oldSize > newSize) {
                bytes += oldSize - newSize;
            }
        }

        return new DiffSummary(files, additions, deletions, bytes);
    }

    private Map<String, String> treeBlobs(String treeish) throws IOException {
        return parseLsFiles(runGitCommand("ls-tree", "-z", "-r", treeish));
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
        if (sha == null || sha.isBlank() || !isBlob(sha)) {
            return 0;
        }
        try {
            return Long.parseLong(runGitWithIndexOrWorking("cat-file", "-s", sha).trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private boolean isBlob(String sha) throws IOException {
        try {
            return "blob".equals(runGitWithIndexOrWorking("cat-file", "-t", sha).trim());
        } catch (IOException e) {
            log.debug("Could not inspect object {}: {}", sha, e.getMessage());
            return false;
        }
    }

    private int countBlobLines(String sha) throws IOException {
        if (sha == null || sha.isBlank() || !isBlob(sha)) {
            return 0;
        }
        Process process = startGit(
            repoDir,
            supervisorIndex == null ? Map.of() : Map.of("GIT_INDEX_FILE", supervisorIndex.toString()),
            "cat-file", "blob", sha);
        int newlines = 0;
        long seenBytes = 0;
        boolean binary = false;
        boolean byteOverflow = false;
        boolean lineOverflow = false;
        try (InputStream input = process.getInputStream()) {
            byte[] buffer = new byte[8_192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                for (int i = 0; i < read; i++) {
                    if (buffer[i] == 0) {
                        binary = true;
                    }
                }
                seenBytes += read;
                if (seenBytes > MAX_COUNTED_BYTES) {
                    byteOverflow = true;
                    break;
                }
                for (int i = 0; i < read; i++) {
                    if (buffer[i] == '\n') {
                        newlines++;
                        if (newlines > MAX_COUNTED_LINES) {
                            lineOverflow = true;
                            break;
                        }
                    }
                }
                if (lineOverflow) {
                    break;
                }
            }
        }
        boolean overflow = byteOverflow || lineOverflow;
        if (overflow) {
            process.destroyForcibly();
        }
        int exit = waitFor(process);
        if (!overflow && exit != 0) {
            throw new IOException("git cat-file failed for blob " + sha);
        }
        if (binary) {
            // Line counts are not meaningful for binary content. The byte guard
            // still accounts for its size.
            log.debug("Binary blob {}; skipping line count", sha);
            return 0;
        }
        if (overflow) {
            // Fail closed for a blob we cannot fully count. Returning 0 here
            // would let a large text file bypass HARNESS_MAX_LINES.
            return MAX_COUNTED_LINES + 1;
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

    private String runGitCommandAllowFailure(String... args) {
        try {
            return runGitCommand(args);
        } catch (IOException e) {
            log.debug("git {} unavailable: {}", redact(String.join(" ", args)), e.getMessage());
            return "";
        }
    }

    /**
     * Delete the workspace directory and all its contents.
     */
    /**
     * Delete clone directories older than the retention window.
     *
     * <p>Only generated workspace names are considered, paths protected by an
     * active run/unexpired lease are skipped, symlinks and non-directories are
     * ignored, and every deletion is re-checked against the clone root.</p>
     */
    public int pruneStaleWorkspaces(Duration retention) throws IOException {
        return pruneStaleWorkspaces(retention, List.of());
    }

    public int pruneStaleWorkspaces(Duration retention, Collection<String> protectedPaths)
        throws IOException {
        if (dryRun || retention == null || retention.isZero() || retention.isNegative()) {
            return 0;
        }
        if (!Files.isDirectory(cloneRoot, LinkOption.NOFOLLOW_LINKS)) {
            return 0;
        }

        Set<Path> protectedDirs = new HashSet<>();
        if (repoDir != null) {
            protectedDirs.add(repoDir.toAbsolutePath().normalize());
        }
        for (String value : protectedPaths == null ? List.<String>of() : protectedPaths) {
            if (value == null || value.isBlank()) {
                continue;
            }
            try {
                protectedDirs.add(Paths.get(value).toAbsolutePath().normalize());
            } catch (RuntimeException e) {
                // Fail closed: an unparseable protected path means we cannot
                // prove the cleanup is safe.
                log.warn("Refusing to prune workspaces: unreadable protected path {}", value);
                return 0;
            }
        }

        Instant cutoff = Instant.now().minus(retention);
        int removed = 0;
        try (Stream<Path> entries = Files.list(cloneRoot)) {
            for (Path entry : entries.toList()) {
                if (!Files.isDirectory(entry, LinkOption.NOFOLLOW_LINKS)) {
                    continue;
                }
                String name = entry.getFileName().toString();
                if (!WORKSPACE_DIR_PATTERN.matcher(name).matches()) {
                    continue;
                }
                Path normalized = entry.toAbsolutePath().normalize();
                if (protectedDirs.contains(normalized)) {
                    continue;
                }
                FileTime modified = Files.getLastModifiedTime(entry, LinkOption.NOFOLLOW_LINKS);
                if (!modified.toInstant().isBefore(cutoff)) {
                    continue;
                }
                assertSafeToDelete(normalized);
                try {
                    deletePath(normalized);
                    removed++;
                } catch (IOException e) {
                    log.warn("Could not prune stale workspace {}: {}", normalized, e.getMessage());
                }
            }
        }
        if (removed > 0) {
            log.info("Pruned {} stale workspace(s) older than {}", removed, retention);
        }
        return removed;
    }

    /**
     * Remove crash-left OpenCode and askpass directories, which may contain
     * provider keys or the GitHub token. Only known prefixes are touched.
     */
    public int pruneStaleTempDirectories(Duration retention) throws IOException {
        return pruneStaleTempDirectories(
            Paths.get(System.getProperty("java.io.tmpdir")), retention);
    }

    int pruneStaleTempDirectories(Path tempRoot, Duration retention) throws IOException {
        if (dryRun || retention == null || retention.isZero() || retention.isNegative()) {
            return 0;
        }
        if (tempRoot == null || !Files.isDirectory(tempRoot, LinkOption.NOFOLLOW_LINKS)) {
            return 0;
        }

        Instant cutoff = Instant.now().minus(retention);
        int removed = 0;
        try (Stream<Path> entries = Files.list(tempRoot)) {
            for (Path entry : entries.toList()) {
                if (!Files.isDirectory(entry, LinkOption.NOFOLLOW_LINKS)) {
                    continue;
                }
                String name = entry.getFileName().toString();
                if (TEMP_DIR_PREFIXES.stream().noneMatch(name::startsWith)) {
                    continue;
                }
                FileTime modified = Files.getLastModifiedTime(entry, LinkOption.NOFOLLOW_LINKS);
                if (!modified.toInstant().isBefore(cutoff)) {
                    continue;
                }
                try {
                    deletePath(entry);
                    removed++;
                } catch (IOException e) {
                    log.warn("Could not prune stale temp directory {}: {}", entry, e.getMessage());
                }
            }
        }
        if (removed > 0) {
            log.info("Pruned {} stale harness temp directory(ies) older than {}", removed, retention);
        }
        return removed;
    }

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

    private void cleanupPath(Path path) throws IOException {
        Path normalized = path.toAbsolutePath().normalize();
        if (normalized.equals(cloneRoot)) {
            // Runtime-root cleanup is deliberately allowed; never allow the
            // filesystem root or a parent outside the configured clone root.
            if (normalized.getParent() == null) {
                throw new IOException("Refusing to delete the filesystem root");
            }
        } else {
            assertSafeToDelete(normalized);
        }
        if (!Files.exists(normalized, LinkOption.NOFOLLOW_LINKS)) {
            return;
        }
        try {
            deletePath(normalized);
        } catch (IOException e) {
            runDeleteFallback(normalized);
            if (Files.exists(normalized, LinkOption.NOFOLLOW_LINKS)) {
                throw new IOException("Failed to delete " + normalized, e);
            }
        }
    }

    private void runDeleteFallback() {
        runDeleteFallback(repoDir);
    }

    private void runDeleteFallback(Path path) {
        try {
            ProcessBuilder rmPb = new ProcessBuilder("rm", "-rf", "--", path.toString());
            rmPb.redirectErrorStream(true);
            Process rmProcess = rmPb.start();
            rmProcess.waitFor();
            log.info("Cleaned up workspace via rm -rf: {}", path);
        } catch (IOException | InterruptedException ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            log.error("Failed to cleanup workspace {}: {}", path, ex.getMessage());
        }
    }

    /**
     * Refuse to delete anything outside REPO_CLONE_DIR (or the clone root
     * itself). This bounds a compromised workspace path or a symlinked
     * repository directory.
     */
    private void assertSafeToDelete(Path path) throws IOException {
        Path normalized = path.toAbsolutePath().normalize();
        Path root = cloneRoot;
        Path target = normalized;
        try {
            if (Files.exists(normalized, LinkOption.NOFOLLOW_LINKS)) {
                target = normalized.toRealPath(LinkOption.NOFOLLOW_LINKS);
            }
            if (Files.exists(root, LinkOption.NOFOLLOW_LINKS)) {
                root = root.toRealPath(LinkOption.NOFOLLOW_LINKS);
            }
        } catch (IOException e) {
            throw new IOException("Cannot resolve delete target safely: " + normalized, e);
        }
        if (!target.startsWith(root) || target.equals(root)) {
            throw new IOException("Path is outside the clone root: " + target);
        }
    }
}
