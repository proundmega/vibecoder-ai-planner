package com.vibecode.agent.service;

import com.vibecode.agent.model.FileOperation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Manages the local git workspace for the agent.
 * Handles cloning repos, writing files, git operations, and commit/push.
 */
public class WorkspaceManager {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceManager.class);

    private final Path repoDir;
    private final String gitBinary;
    private final boolean dryRun;
    private final String githubToken;
    private final Path credentialHelperScript;

    public WorkspaceManager(String repoCloneDir, String repoName, boolean dryRun, String githubToken) {
        this.repoDir = Paths.get(repoCloneDir, sanitizePath(repoName));
        this.gitBinary = "git";
        this.dryRun = dryRun;
        this.githubToken = githubToken;
        this.credentialHelperScript = null;
    }

    /**
     * Clone a repository if it doesn't exist locally.
     */
    public void cloneRepo(String repoUrl, String branchName) throws IOException {
        if (Files.exists(repoDir.resolve(".git"))) {
            log.info("Repo already cloned at {}", repoDir);
            return;
        }

        log.info("Cloning repo from {} to {}", repoUrl, repoDir);
        if (dryRun) {
            log.info("[DRY RUN] Would clone {} to {}", repoUrl, repoDir);
            return;
        }

        // Create parent directory if needed
        Files.createDirectories(repoDir.getParent());

        // Clone without authentication first (works for public repos)
        // or with credential helper configured for private repos
        if (githubToken != null && !githubToken.isBlank() && repoUrl.startsWith("https://github.com/")) {
            // Create credential helper script in the repo's .git directory
            Path helperScript = repoDir.resolve(".git/credential-helper.sh");
            String scriptContent = "#!/bin/sh\necho \"username=oauth2\"\necho \"password=" + githubToken + "\"";
            Files.writeString(helperScript, scriptContent);
            // Restrict permissions to owner only (0600 equivalent)
            Files.setPosixFilePermissions(helperScript, 
                java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
            
            // Clone with credential helper configured
            ProcessBuilder pb = new ProcessBuilder(
                gitBinary, "-c", "credential.helper=!f() { source \"" + helperScript + "\"; }; f",
                "clone", repoUrl, repoDir.toString()
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
                throw new IOException("Git clone failed: " + output);
            }
            
            // Configure git to use credential helper for all future operations
            runGit("config", "credential.helper", "!f() { source \"" + helperScript + "\"; }; f");
        } else {
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

        // git add -A
        runGit("add", "-A");

        // git commit
        runGit("commit", "-m", message);

        // git push origin HEAD:branchName
        runGit("push", "origin", "HEAD:" + branchName);

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
            throw new IOException("git " + String.join(" ", args) + " failed: " + output);
        }
        
        return output.trim();
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
}
