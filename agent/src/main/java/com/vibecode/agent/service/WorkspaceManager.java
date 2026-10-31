package com.vibecode.agent.service;

import com.vibecode.agent.harness.DiffSummary;
import com.vibecode.agent.model.FileOperation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Manages the local git workspace for the agent.
 * Handles cloning repos, writing files, git operations, and commit/push.
 */
public class WorkspaceManager {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceManager.class);

    private Path repoDir;
    private final String gitBinary;
    private final boolean dryRun;
    private final String githubToken;
    private final Path credentialHelperScript;
    private final String repoCloneDir;
    private final String repoName;
    private String authenticatedRemoteUrl;

    public WorkspaceManager(String repoCloneDir, String repoName, boolean dryRun, String githubToken) {
        this.repoCloneDir = repoCloneDir;
        this.repoName = repoName;
        this.gitBinary = "git";
        this.dryRun = dryRun;
        this.githubToken = githubToken;
        this.credentialHelperScript = null;
        this.repoDir = null;
    }

    private Path generateRepoDir() {
        String uniqueName = UUID.randomUUID().toString().substring(0, 8) + "-" + sanitizePath(repoName);
        return Paths.get(repoCloneDir, uniqueName);
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

        // Remove existing directory if present (from failed previous attempt)
        if (Files.exists(repoDir)) {
            log.info("Removing existing directory: {}", repoDir);
            try {
                deletePath(repoDir);
            } catch (IOException e) {
                log.warn("Java delete failed, trying shell rm -rf: {}", e.getMessage());
                try {
                    ProcessBuilder rmPb = new ProcessBuilder("rm", "-rf", repoDir.toString());
                    rmPb.redirectErrorStream(true);
                    Process rmProcess = rmPb.start();
                    rmProcess.waitFor();
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    log.error("rm -rf interrupted while deleting: {}", repoDir);
                    throw new IOException("Delete interrupted: " + repoDir, ie);
                }
            }
            if (Files.exists(repoDir)) {
                log.error("Directory still exists after delete, aborting clone");
                throw new IOException("Failed to remove existing directory: " + repoDir);
            }
        }

        // Create parent directory if needed
        Files.createDirectories(repoDir.getParent());

        // Clone without authentication first (works for public repos)
        // or with credential helper configured for private repos
        if (githubToken != null && !githubToken.isBlank() && repoUrl.startsWith("https://github.com/")) {
            // Clone with token embedded in URL for authentication
            String authenticatedUrl = repoUrl.replace("https://github.com/", "https://" + githubToken + "@github.com/");
            ProcessBuilder pb = new ProcessBuilder(
                gitBinary, "clone", authenticatedUrl, repoDir.toString()
            );
            pb.redirectErrorStream(true);
            Process process = pb.start();
            
            String output = readProcessOutput(process);
            int exitCode;
            try {
                exitCode = process.waitFor();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Clone interrupted: " + e.getMessage());
            }
            
            if (exitCode != 0) {
                throw new IOException("Git clone failed: " + redact(output));
            }
            
            // Keep the token out of .git/config: the harness runs in this
            // workspace and must never be able to read the GitHub credential.
            // The supervisor reuses authenticatedUrl only for its own push.
            this.authenticatedRemoteUrl = authenticatedUrl;
            runGit("remote", "set-url", "origin", stripCredentials(authenticatedUrl));
        } else {
            this.authenticatedRemoteUrl = null;
            ProcessBuilder pb = new ProcessBuilder(gitBinary, "clone", repoUrl, repoDir.toString());
            pb.redirectErrorStream(true);
            Process process = pb.start();
            
            String output = readProcessOutput(process);
            int exitCode;
            try {
                exitCode = process.waitFor();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Clone interrupted: " + e.getMessage());
            }
            
            if (exitCode != 0) {
                throw new IOException("Git clone failed: " + output);
            }
        }

        // Create and checkout the target branch
        ProcessBuilder checkoutPb = new ProcessBuilder(gitBinary, "checkout", "-b", branchName);
        checkoutPb.directory(repoDir.toFile());
        checkoutPb.redirectErrorStream(true);
        Process checkoutProcess = checkoutPb.start();
        
        String checkoutOutput = readProcessOutput(checkoutProcess);
        int checkoutExitCode;
        try {
            checkoutExitCode = checkoutProcess.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Checkout interrupted: " + e.getMessage());
        }
        
        if (checkoutExitCode != 0) {
            throw new IOException("Git checkout failed: " + checkoutOutput);
        }
        
        log.info("Successfully cloned repo to {} and created branch {}", repoDir, branchName);
    }

    /**
     * Write multiple files to the workspace.
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

    /**
     * Stage all changes, commit, and push to remote.
     */
    public String commitAndPush(String message, String branchName) throws IOException {
        if (dryRun) {
            log.info("[DRY RUN] Would commit and push: {}", message);
            return "dry-run-sha";
        }

        // Configure git identity if not already set
        runGit("config", "user.email", "agent@vibecode.ai");
        runGit("config", "user.name", "Vibecode Agent");

        // git add -A
        runGit("add", "-A");

        // git commit
        runGit("commit", "-m", message);

        // Push with the authenticated URL in memory instead of persisting the
        // token in the workspace remote.
        String pushTarget = authenticatedRemoteUrl != null && !authenticatedRemoteUrl.isBlank()
            ? authenticatedRemoteUrl
            : "origin";
        runGit("push", pushTarget, "HEAD:" + branchName, "--force-with-lease");

        // git rev-parse HEAD
        return getCommitSha();
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
        if (!Files.exists(repoDir)) {
            return List.of();
        }
        
        return Files.walk(repoDir)
            .filter(Files::isRegularFile)
            .filter(p -> !p.toString().contains("/.git/"))
            .map(p -> repoDir.relativize(p).toString())
            .collect(Collectors.toList());
    }

    private void writeSingleFile(FileOperation fileOp) throws IOException {
        Path targetPath = repoDir.resolve(fileOp.getPath());
        
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
                if (Files.exists(targetPath)) {
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
        String[] fullArgs = new String[args.length + 1];
        fullArgs[0] = gitBinary;
        System.arraycopy(args, 0, fullArgs, 1, args.length);
        ProcessBuilder pb = new ProcessBuilder(fullArgs);
        pb.directory(repoDir.toFile());
        pb.redirectErrorStream(true);
        
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

    private String readProcessOutput(Process process) throws IOException {
        byte[] buffer = new byte[4096];
        java.io.InputStream is = process.getInputStream();
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        int bytesRead;
        while ((bytesRead = is.read(buffer)) != -1) {
            baos.write(buffer, 0, bytesRead);
        }
        return baos.toString(java.nio.charset.StandardCharsets.UTF_8);
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

    private void deletePath(Path path) throws IOException {
        if (Files.isDirectory(path)) {
            java.util.List<Path> children = java.nio.file.Files.list(path).toList();
            for (Path child : children) {
                deletePath(child);
            }
        }
        Files.delete(path);
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
     */
    public DiffSummary collectDiff() throws IOException {
        if (repoDir == null || !Files.exists(repoDir)) {
            return DiffSummary.empty();
        }

        String porcelain = runGitCommand("status", "--porcelain");
        List<DiffSummary.ChangedFile> files = new ArrayList<>();
        Set<String> untracked = new HashSet<>();

        for (String line : porcelain.split("\\R")) {
            if (line == null || line.length() < 3) {
                continue;
            }
            String code = line.substring(0, 2);
            String path = line.substring(3).trim();
            int arrow = path.indexOf(" -> ");
            if (arrow >= 0) {
                path = path.substring(arrow + 4);
            }
            if (path.isBlank()) {
                continue;
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

        return new DiffSummary(files, additions, deletions);
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

    private int countLines(Path file) {
        if (file == null || !Files.isRegularFile(file)) {
            return 0;
        }
        try (var lines = Files.lines(file)) {
            return (int) Math.min(Integer.MAX_VALUE, lines.count());
        } catch (IOException e) {
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
        if (Files.exists(repoDir)) {
            try {
                deletePath(repoDir);
                log.info("Cleaned up workspace: {}", repoDir);
            } catch (IOException e) {
                log.warn("Java delete failed, trying shell rm -rf: {}", e.getMessage());
                try {
                    ProcessBuilder rmPb = new ProcessBuilder("rm", "-rf", repoDir.toString());
                    rmPb.redirectErrorStream(true);
                    Process rmProcess = rmPb.start();
                    rmProcess.waitFor();
                    log.info("Cleaned up workspace via rm -rf: {}", repoDir);
                } catch (IOException | InterruptedException ex) {
                    log.error("Failed to cleanup workspace {}: {}", repoDir, ex.getMessage());
                }
            }
        }
    }
}
