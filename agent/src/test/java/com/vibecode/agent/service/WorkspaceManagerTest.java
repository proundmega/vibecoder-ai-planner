package com.vibecode.agent.service;

import com.vibecode.agent.harness.DiffSummary;
import com.vibecode.agent.harness.PublishingGuard;
import com.vibecode.agent.model.FileOperation;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WorkspaceManagerTest {

    @TempDir
    Path tempDir;

    private static void assumePosix() {
        Assumptions.assumeTrue(
            FileSystems.getDefault().supportedFileAttributeViews().contains("posix"),
            "POSIX permissions/symlinks are not supported on this platform");
    }

    private Path setRepoDir(WorkspaceManager wm, Path repoDir) throws Exception {
        Field repoDirField = wm.getClass().getDeclaredField("repoDir");
        repoDirField.setAccessible(true);
        repoDirField.set(wm, repoDir);
        return repoDir;
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private Path initRepo(String name) throws Exception {
        Path repo = tempDir.resolve(name);
        Files.createDirectories(repo);
        runGit(repo, "init");
        runGit(repo, "config", "user.email", "test@example.com");
        runGit(repo, "config", "user.name", "Test User");
        Files.writeString(repo.resolve("README.md"), "initial\n");
        runGit(repo, "add", ".");
        runGit(repo, "commit", "-m", "initial");
        return repo;
    }

    private Path initBare(String name) throws Exception {
        Path bare = tempDir.resolve(name);
        Files.createDirectories(bare);
        runGit(bare, "init", "--bare");
        return bare;
    }

    @Test
    void testConstructorWithBooleanDryRun() {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", true, null);
        assertNotNull(wm);
    }

    @Test
    void testConstructorWithFalseDryRun() {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        assertNotNull(wm);
    }

    @Test
    void testRepoDirSanitization() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "my-repo_name!@#", true, null);
        // cloneRepo generates UUID-based dir, verify sanitized name is present
        assertDoesNotThrow(() -> wm.cloneRepo("https://github.com/test/repo.git", "feature-branch"));
        Field repoDirField = wm.getClass().getDeclaredField("repoDir");
        repoDirField.setAccessible(true);
        Path actualRepoDir = (Path) repoDirField.get(wm);
        // UUID prefix + sanitized name should be in the path
        String pathStr = actualRepoDir.toString();
        assertTrue(pathStr.contains("my-repo_name___"), "Path should contain sanitized name but was: " + pathStr);
    }

    @Test
    void testWriteFilesCreatesDirectoryStructure() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        Path repoDir = tempDir.resolve("test-repo");
        Files.createDirectories(repoDir);
        setRepoDir(wm, repoDir);
        
        FileOperation fileOp = new FileOperation("src/main/java/com/example/App.java", 
            "package com.example;\n\npublic class App {}\n", 
            FileOperation.Action.CREATE);
        
        wm.writeFiles(List.of(fileOp));
        
        Path targetPath = repoDir.resolve("src/main/java/com/example/App.java");
        assertTrue(Files.exists(targetPath));
        assertEquals("package com.example;\n\npublic class App {}\n", Files.readString(targetPath));
    }

    @Test
    void testWriteFilesEmptyList() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        wm.writeFiles(List.of());
    }

    @Test
    void testWriteFilesNullList() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        wm.writeFiles(null);
    }

    @Test
    void testWriteFilesDryRun() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", true, null);
        FileOperation fileOp = new FileOperation("src/main/java/com/example/App.java", 
            "package com.example;\n\npublic class App {}\n", 
            FileOperation.Action.CREATE);
        
        assertDoesNotThrow(() -> wm.writeFiles(List.of(fileOp)));
    }

    @Test
    void testWriteFileDelete() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        Path repoDir = tempDir.resolve("test-repo");
        Files.createDirectories(repoDir);
        setRepoDir(wm, repoDir);
        
        Path existingFile = repoDir.resolve("src/old-file.java");
        Files.createDirectories(existingFile.getParent());
        Files.writeString(existingFile, "old content");
        assertTrue(Files.exists(existingFile));
        
        FileOperation deleteOp = new FileOperation("src/old-file.java", null, FileOperation.Action.DELETE);
        wm.writeFiles(List.of(deleteOp));
        
        assertFalse(Files.exists(existingFile));
    }

    @Test
    void testWriteFileModify() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        Path repoDir = tempDir.resolve("test-repo");
        Files.createDirectories(repoDir);
        setRepoDir(wm, repoDir);
        
        Path existingFile = repoDir.resolve("src/App.java");
        Files.createDirectories(existingFile.getParent());
        Files.writeString(existingFile, "old content");
        
        FileOperation modifyOp = new FileOperation("src/App.java", "new content", FileOperation.Action.MODIFY);
        wm.writeFiles(List.of(modifyOp));
        
        assertEquals("new content", Files.readString(existingFile));
    }

    @Test
    void testCloneRepoDryRun() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", true, null);
        assertDoesNotThrow(() -> wm.cloneRepo("https://github.com/nonexistent/repo.git", "feature-branch"));
    }

    @Test
    void testCloneRepoAlreadyExists() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", true, null);
        Path repoDir = tempDir.resolve("acf5e45f-test-repo");
        Files.createDirectories(repoDir);
        Files.createDirectories(repoDir.resolve(".git"));
        
        // In dry-run mode, cloneRepo should not throw even if dir exists
        assertDoesNotThrow(() -> wm.cloneRepo("https://github.com/test/repo.git", "feature-branch"));
    }

    @Test
    void testCommitShaDryRun() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", true, null);
        String sha = wm.getCommitSha();
        assertEquals("dry-run-sha", sha);
    }

    @Test
    void testCommitAndPushDryRun() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", true, null);
        String sha = wm.commitAndPush("test commit", "feature-branch");
        assertEquals("dry-run-sha", sha);
    }

    @Test
    void testFileOperationActions() {
        assertEquals("CREATE", FileOperation.Action.CREATE.name());
        assertEquals("MODIFY", FileOperation.Action.MODIFY.name());
        assertEquals("DELETE", FileOperation.Action.DELETE.name());
    }

    @Test
    void testFileOperationCreate() {
        FileOperation op = new FileOperation("src/App.java", "content", FileOperation.Action.CREATE);
        assertEquals("src/App.java", op.getPath());
        assertEquals("content", op.getContent());
        assertEquals(FileOperation.Action.CREATE, op.getAction());
        assertNull(op.getSearch());
    }

    @Test
    void testFileOperationDelete() {
        FileOperation op = new FileOperation("src/old.java", null, FileOperation.Action.DELETE);
        assertEquals("src/old.java", op.getPath());
        assertNull(op.getContent());
        assertEquals(FileOperation.Action.DELETE, op.getAction());
    }

    @Test
    void testFileOperationWithSearch() {
        FileOperation op = new FileOperation("src/App.java", "content", FileOperation.Action.MODIFY);
        op.setSearch("old pattern");
        assertEquals("old pattern", op.getSearch());
    }

    @Test
    void testCreateCredentialHelperCreatesFileWithToken() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, "ghp_testtoken123");
        Path helperScript = wm.createCredentialHelper(tempDir.resolve("test-repo"), "ghp_testtoken123");

        assertTrue(Files.exists(helperScript));
        String content = Files.readString(helperScript);
        assertTrue(content.contains("ghp_testtoken123"));
        assertTrue(content.contains("username=oauth2"));
        assertTrue(content.contains("password=ghp_testtoken123"));
    }

    @Test
    void testCreateCredentialHelperHasRestrictedPermissions() throws Exception {
        Assumptions.assumeTrue(
            FileSystems.getDefault().supportedFileAttributeViews().contains("posix"),
            "POSIX permissions are not supported on this platform");
        Path targetDir = tempDir.resolve("perms-test");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        Path helperScript = wm.createCredentialHelper(targetDir, "secret-token");

        var perms = Files.getPosixFilePermissions(helperScript);
        // 0700 = owner read + write + execute only, no group/other permissions
        assertTrue(perms.contains(java.nio.file.attribute.PosixFilePermission.OWNER_READ));
        assertTrue(perms.contains(java.nio.file.attribute.PosixFilePermission.OWNER_WRITE));
        assertTrue(perms.contains(java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE));
        assertFalse(perms.contains(java.nio.file.attribute.PosixFilePermission.GROUP_READ));
        assertFalse(perms.contains(java.nio.file.attribute.PosixFilePermission.GROUP_WRITE));
        assertFalse(perms.contains(java.nio.file.attribute.PosixFilePermission.GROUP_READ));
        assertFalse(perms.contains(java.nio.file.attribute.PosixFilePermission.OTHERS_READ));
        assertFalse(perms.contains(java.nio.file.attribute.PosixFilePermission.OTHERS_WRITE));
    }

    @Test
    void testCollectDiffReportsModifiedAndUntrackedFiles() throws Exception {
        Path repoDir = tempDir.resolve("diff-repo");
        Files.createDirectories(repoDir);
        runGit(repoDir, "init");
        runGit(repoDir, "config", "user.email", "test@example.com");
        runGit(repoDir, "config", "user.name", "Test User");
        Files.writeString(repoDir.resolve("tracked.txt"), "one\n");
        runGit(repoDir, "add", ".");
        runGit(repoDir, "commit", "-m", "initial");

        Files.writeString(repoDir.resolve("tracked.txt"), "one\ntwo\n");
        Files.writeString(repoDir.resolve("new.txt"), "a\nb\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = wm.collectDiff();

        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("tracked.txt") && file.status().equals("modified")));
        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("new.txt") && file.status().equals("added")));
        assertEquals(3, diff.additions());
        assertEquals(0, diff.deletions());
    }

    @Test
    void collectDiffExpandsNewDirectoriesSoProtectedFilesCannotHide() throws Exception {
        Path repoDir = initRepo("untracked-dirs");
        java.nio.file.Files.createDirectories(repoDir.resolve(".github/workflows"));
        java.nio.file.Files.createDirectories(repoDir.resolve("cfg"));
        Files.writeString(repoDir.resolve(".github/workflows/evil.yml"),
            "name: evil\non: push\n");
        Files.writeString(repoDir.resolve("cfg/.env"), "SECRET=value\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = wm.collectDiff();
        List<String> paths = diff.files().stream().map(DiffSummary.ChangedFile::path).toList();

        assertTrue(paths.contains(".github/workflows/evil.yml"), "paths=" + paths);
        assertTrue(paths.contains("cfg/.env"), "paths=" + paths);
        assertFalse(paths.contains(".github/"));
        assertFalse(paths.contains("cfg/"));
        assertEquals(3, diff.additions());
        assertTrue(diff.changedBytes() > 0);
    }

    @Test
    void collectDiffCountsBinaryUntrackedFilesWithoutThrowing() throws Exception {
        Path repoDir = initRepo("binary");
        byte[] binary = new byte[]{0x00, (byte) 0xff, 0x10, 0x0a, (byte) 0x80};
        Files.write(repoDir.resolve("fixture.bin"), binary);

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = assertDoesNotThrow(wm::collectDiff);

        assertTrue(diff.files().stream().anyMatch(file -> file.path().equals("fixture.bin")));
        assertTrue(diff.changedBytes() >= binary.length);
    }

    @Test
    void stageAllThenCollectDiffReportsTheIndexThatWillBeCommitted() throws Exception {
        Path repoDir = initRepo("staged");
        Files.writeString(repoDir.resolve("README.md"), "initial\nchanged\n");
        Files.writeString(repoDir.resolve("added.txt"), "one\ntwo\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        wm.stageAll();

        DiffSummary diff = wm.collectDiff();

        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("README.md") && file.status().equals("modified")));
        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("added.txt") && file.status().equals("added")));
        assertEquals(3, diff.additions());
    }

    @Test
    void cleanupDeletesSymlinkItselfAndNeverItsTarget() throws Exception {
        assumePosix();
        Path repoDir = initRepo("symlink-repo");
        Path victim = Files.createDirectories(tempDir.resolve("victim"));
        Files.writeString(victim.resolve("data.txt"), "do not delete");
        Files.createSymbolicLink(repoDir.resolve("link"), victim);

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        wm.cleanup();

        assertTrue(Files.exists(victim.resolve("data.txt")), "cleanup followed a symlink outside the repo");
        assertFalse(Files.exists(repoDir, java.nio.file.LinkOption.NOFOLLOW_LINKS));
    }

    @Test
    void cleanupRefusesPathOutsideCloneRoot() throws Exception {
        Path outside = Files.createDirectories(tempDir.resolve("outside-root"));
        Files.writeString(outside.resolve("keep.txt"), "keep");
        Path cloneRoot = Files.createDirectories(tempDir.resolve("clone-root"));

        WorkspaceManager wm = new WorkspaceManager(cloneRoot.toString(), "test-repo", false, null);
        setRepoDir(wm, outside);
        wm.cleanup();

        assertTrue(Files.exists(outside.resolve("keep.txt")));
    }

    @Test
    void commitAndPushIgnoresAgentControlledHooksAndConfig() throws Exception {
        assumePosix();
        Path repoDir = initRepo("malicious-hooks");
        Path bare = initBare("malicious-hooks.git");
        runGit(repoDir, "remote", "add", "origin", bare.toString());
        String trustedConfig = Files.readString(repoDir.resolve(".git/config"));

        Path marker = tempDir.resolve("hook-ran.txt");
        Path hooks = Files.createDirectories(repoDir.resolve(".git/hooks"));
        Files.writeString(hooks.resolve("pre-commit"),
            "#!/bin/sh\necho ran > '" + marker + "'\nexit 0\n");
        Files.setPosixFilePermissions(hooks.resolve("pre-commit"),
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));

        // Agent-controlled config: hooksPath, a clean filter and URL rewriting.
        Files.writeString(repoDir.resolve(".git/config"),
            trustedConfig
                + "\n[core]\n\thooksPath = " + hooks + "\n"
                + "[filter \"evil\"]\n\tclean = sh -c 'echo filter-ran >> " + marker + "'\n"
                + "[url \"https://evil.invalid/\"]\n\tpushInsteadOf = " + bare + "\n");

        Files.writeString(repoDir.resolve(".gitattributes"), "README.md filter=evil\n");
        Files.writeString(repoDir.resolve("README.md"), "initial\nchanged\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        setField(wm, "trustedGitConfig", trustedConfig);

        String sha = wm.commitAndPush("test commit", "feature");

        assertNotNull(sha);
        assertFalse(Files.exists(marker), "agent-controlled git hook/filter executed");
        runGit(bare, "rev-parse", "--verify", "refs/heads/feature");
    }

    @Test
    void endToEndCloneEditGuardAndPublishAgainstLocalBareRepo() throws Exception {
        Path source = initRepo("e2e-source");
        Path bare = initBare("e2e-remote.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "e2e", false, null);
        wm.cloneRepo(bare.toString(), "vibecode/ticket-1-e2e");

        // Simulate the harness editing the workspace after the clone.
        Files.writeString(wm.getRepoDir().resolve("feature.txt"), "implemented\n");
        wm.stageAll();
        DiffSummary diff = wm.collectDiff();
        new PublishingGuard(List.of(".env*", "**/.env*", "Jenkinsfile", ".github/**"))
            .assertPublishable(diff);

        wm.commitAndPushStaged("feat: e2e", "vibecode/ticket-1-e2e");

        runGit(bare, "rev-parse", "--verify", "refs/heads/vibecode/ticket-1-e2e");
        assertEquals(1, diff.files().stream()
            .filter(file -> file.path().equals("feature.txt")).count());
    }

    @Test
    void commitAndPushCanUpdateAPreExistingRemoteBranch() throws Exception {
        Path repoDir = initRepo("existing-branch");
        Path bare = initBare("existing-branch.git");
        runGit(repoDir, "remote", "add", "origin", bare.toString());
        String trustedConfig = Files.readString(repoDir.resolve(".git/config"));
        runGit(repoDir, "push", "origin", "HEAD:refs/heads/feature");

        Files.writeString(repoDir.resolve("README.md"), "initial\nretry\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        setField(wm, "trustedGitConfig", trustedConfig);

        String sha = wm.commitAndPush("retry", "feature");

        assertNotNull(sha);
        runGit(bare, "rev-parse", "--verify", "refs/heads/feature");
    }

    @Test
    void stageFreshDiffIgnoresIndexOnlyBlobsAndAssumeUnchanged() throws Exception {
        Path repoDir = initRepo("index-only");
        String big = "x".repeat(20_000);
        String sha = gitOutputWithInput(repoDir, big, "hash-object", "-w", "--stdin");
        runGit(repoDir, "update-index", "--add", "--cacheinfo", "100644," + sha + ",big.txt");
        runGit(repoDir, "update-index", "--assume-unchanged", "big.txt");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = wm.stageFreshDiff();
        try {
            assertFalse(diff.files().stream()
                .anyMatch(file -> file.path().equals("big.txt")),
                "index-only cache entry must not be published");
            assertEquals(0, diff.changedBytes());
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void collectDiffCountsIndexOnlyBlobBytes() throws Exception {
        Path repoDir = initRepo("index-only-bytes");
        String big = "x".repeat(20_000);
        String sha = gitOutputWithInput(repoDir, big, "hash-object", "-w", "--stdin");
        runGit(repoDir, "update-index", "--add", "--cacheinfo", "100644," + sha + ",big.txt");
        runGit(repoDir, "update-index", "--assume-unchanged", "big.txt");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = wm.collectDiff();

        assertTrue(diff.files().stream().anyMatch(file -> file.path().equals("big.txt")));
        assertTrue(diff.changedBytes() >= 20_000,
            "index-only blob bytes must be guarded, got " + diff.changedBytes());
    }

    @Test
    void stageFreshDiffDoesNotMissSkipWorktreeModifications() throws Exception {
        Path repoDir = initRepo("skip-worktree");
        runGit(repoDir, "update-index", "--skip-worktree", "README.md");
        Files.writeString(repoDir.resolve("README.md"), "initial\nmodified\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = wm.stageFreshDiff();
        try {
            assertTrue(diff.files().stream().anyMatch(
                file -> file.path().equals("README.md") && file.status().equals("modified")));
            assertEquals(1, diff.additions());
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void stageFreshDiffCountsLinesFromBlobsNotGitAttributes() throws Exception {
        Path repoDir = initRepo("diff-attribute");
        Files.writeString(repoDir.resolve(".gitattributes"), "* -diff\n");
        Files.writeString(repoDir.resolve("big.txt"), "line\n".repeat(5_000));
        runGit(repoDir, "add", ".gitattributes", "big.txt");
        runGit(repoDir, "commit", "-m", "attribute and big file");

        Files.writeString(repoDir.resolve("big.txt"), "changed\n".repeat(5_000));

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = wm.stageFreshDiff();
        try {
            assertEquals(5_000, diff.additions());
            assertTrue(diff.changedBytes() > 5_000);
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void protectedOldPathSurvivesRename() throws Exception {
        Path repoDir = initRepo("rename-protected");
        Files.writeString(repoDir.resolve("Jenkinsfile"), "pipeline {}\n");
        runGit(repoDir, "add", "Jenkinsfile");
        runGit(repoDir, "commit", "-m", "jenkinsfile");
        Files.createDirectories(repoDir.resolve("docs"));
        runGit(repoDir, "mv", "Jenkinsfile", "docs/old-jenkins.txt");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = wm.stageFreshDiff();
        try {
            assertTrue(diff.files().stream().anyMatch(
                file -> file.path().equals("Jenkinsfile") && file.status().equals("deleted")));
            PublishingGuard guard = new PublishingGuard(
                List.of(".env*", "**/.env*", "Jenkinsfile", ".github/**"));
            assertThrows(IllegalStateException.class, () -> guard.assertPublishable(diff));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void publishesTheGuardedTreeEvenIfWorktreeChangesAfterGuard() throws Exception {
        Path repoDir = initRepo("guarded-tree");
        Path bare = initBare("guarded-tree.git");
        runGit(repoDir, "remote", "add", "origin", bare.toString());
        String trustedConfig = Files.readString(repoDir.resolve(".git/config"));

        Files.writeString(repoDir.resolve("feature.txt"), "guarded\n");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        setField(wm, "trustedGitConfig", trustedConfig);

        DiffSummary diff = wm.stageFreshDiff();
        new PublishingGuard(List.of()).assertPublishable(diff);
        Files.writeString(repoDir.resolve("feature.txt"), "changed-after-guard\n");
        wm.commitAndPushStaged("feat: guarded tree", "feature");
        wm.discardStaged();

        assertEquals("guarded", gitOutput(bare, "show", "refs/heads/feature:feature.txt"));
    }

    @Test
    void writeFilesRefusesSymlinkedParentOutsideWorkspace() throws Exception {
        assumePosix();
        Path repoDir = initRepo("symlink-write");
        Path victim = Files.createDirectories(tempDir.resolve("write-victim"));
        Files.createSymbolicLink(repoDir.resolve("link"), victim);

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        FileOperation op = new FileOperation(
            "link/escape.txt", "escaped", FileOperation.Action.CREATE);

        assertThrows(IOException.class, () -> wm.writeFiles(List.of(op)));
        assertFalse(Files.exists(victim.resolve("escape.txt")));
    }

    @Test
    void stripCredentialsRemovesGitHubToken() {
        assertEquals(
            "https://github.com/owner/repo.git",
            WorkspaceManager.stripCredentials("https://ghp_secret@github.com/owner/repo.git"));
        assertEquals(
            "https://github.com/owner/repo.git",
            WorkspaceManager.stripCredentials("https://github.com/owner/repo.git"));
    }

    @Test
    void testCollectDiffWithoutWorkspaceIsEmpty() throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);

        assertTrue(wm.collectDiff().isEmpty());
    }

    private static void runGit(Path directory, String... args) throws Exception {
        gitOutput(directory, args);
    }

    private static String gitOutput(Path directory, String... args) throws Exception {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.addAll(List.of(args));
        Process process = new ProcessBuilder(command)
            .directory(directory.toFile())
            .redirectErrorStream(true)
            .start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        assertEquals(0, exit, "git " + String.join(" ", args) + " failed: " + output);
        return output.strip();
    }

    private static String gitOutputWithInput(Path directory, String input, String... args) throws Exception {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.addAll(List.of(args));
        Process process = new ProcessBuilder(command)
            .directory(directory.toFile())
            .redirectErrorStream(true)
            .start();
        process.getOutputStream().write(input.getBytes(StandardCharsets.UTF_8));
        process.getOutputStream().close();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        assertEquals(0, exit, "git " + String.join(" ", args) + " failed: " + output);
        return output.strip();
    }
}
