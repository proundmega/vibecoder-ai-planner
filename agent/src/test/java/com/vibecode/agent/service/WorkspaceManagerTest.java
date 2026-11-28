package com.vibecode.agent.service;

import com.vibecode.agent.harness.DiffSummary;
import com.vibecode.agent.harness.PublishingGuard;
import com.vibecode.agent.harness.SecretLeakGuard;
import com.vibecode.agent.model.FileOperation;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WorkspaceManagerTest {

    @Test
    void onlyAuthenticatesAgainstTheConfiguredProviderOrigin() {
        WorkspaceManager manager = new WorkspaceManager(
            "/tmp/ws", "repo", false, "token", () -> "token", null,
            "https://git.example.com");

        assertTrue(manager.shouldAuthenticate("https://git.example.com/group/repo.git"));
        assertFalse(manager.shouldAuthenticate("https://evil.example.com/group/repo.git"));
        assertFalse(manager.shouldAuthenticate("http://git.example.com/group/repo.git"));
        assertFalse(manager.shouldAuthenticate("ssh://git@git.example.com/group/repo.git"));
    }

    @Test
    void configuredNonHttpsOriginsFailClosed() {
        for (String configured : List.of(
            "http://git.example.com",
            "ssh://git@git.example.com",
            "not a url")) {
            WorkspaceManager manager = new WorkspaceManager(
                "/tmp/ws", "repo", false, "token", () -> "token", null, configured);

            assertFalse(manager.shouldAuthenticate("https://git.example.com/group/repo.git"),
                configured + " must not authenticate an https remote");
            assertFalse(manager.shouldAuthenticate("http://git.example.com/group/repo.git"),
                configured + " must not authenticate an http remote");
            assertFalse(manager.shouldAuthenticate("ssh://git@git.example.com/group/repo.git"),
                configured + " must not authenticate an ssh remote");
        }
    }

    @Test
    void configuredOriginWithoutAReadableRemoteFailsClosed() throws Exception {
        WorkspaceManager configured = new WorkspaceManager(
            tempDir.toString(), "repo", false, "token", () -> "token", null,
            "https://git.example.com");
        setRepoDir(configured, Files.createDirectories(tempDir.resolve("no-origin-repo")));
        assertFalse(configured.shouldAuthenticateRemote(),
            "a configured origin must not authenticate when the remote is unreadable");

        WorkspaceManager legacy = new WorkspaceManager(
            tempDir.toString(), "legacy-repo", false, "token", () -> "token");
        setRepoDir(legacy, Files.createDirectories(tempDir.resolve("legacy-no-origin")));
        assertTrue(legacy.shouldAuthenticateRemote(),
            "legacy construction keeps the old behaviour");
    }

    @Test
    void askPassScriptAllowsOnlyTheExactHttpsAuthority() throws Exception {
        assumePosix();
        Path script = writeAskPassScript("git.example.com");

        assertEquals("secret", runAskPass(script, "Password for 'https://git.example.com':"));
        assertEquals("secret", runAskPass(script, "Password for 'https://git.example.com:443':"));
        // Git repeats the username in the password prompt after oauth2.
        assertEquals("secret",
            runAskPass(script, "Password for 'https://oauth2@git.example.com':"));
        assertEquals("secret",
            runAskPass(script, "Password for 'https://oauth2@git.example.com:443':"));
        assertEquals("secret",
            runAskPass(script, "Password for 'https://user:pass@git.example.com':"));
        // Hosts are case-insensitive; the guard normalizes the authority.
        assertEquals("secret",
            runAskPass(script, "Password for 'https://oauth2@Git.Example.COM':"));
        assertEquals("secret",
            runAskPass(script, "Password for 'https://GIT.EXAMPLE.COM:443':"));
        // URL schemes are case-insensitive too.
        assertEquals("secret",
            runAskPass(script, "Password for 'HTTPS://oauth2@git.example.com':"));
        assertEquals("oauth2", runAskPass(script, "Username for 'Https://git.example.com/':"));

        for (String prompt : List.of(
            "Password for 'https://git.example.com.evil.com':",
            "Password for 'https://notgit.example.com':",
            "Password for 'http://git.example.com':",
            "Password for 'http://oauth2@git.example.com':",
            "Password for 'https://git.example.com:444':",
            "Password for 'https://oauth2@git.example.com:444':",
            "Password for 'https://oauth2@GIT.EXAMPLE.COM.EVIL.COM':",
            "Password for 'HTTPS://oauth2@git.example.com.evil.com':",
            "Password for 'https://evil.com/?next=https://git.example.com':")) {
            assertNotEquals("secret", runAskPass(script, prompt), prompt);
        }

        Path portScript = writeAskPassScript("git.example.com:8443");
        assertEquals("secret",
            runAskPass(portScript, "Password for 'https://git.example.com:8443/':"));
        assertEquals("secret",
            runAskPass(portScript, "Password for 'https://oauth2@git.example.com:8443':"));
        assertNotEquals("secret",
            runAskPass(portScript, "Password for 'https://git.example.com':"));
        assertNotEquals("secret",
            runAskPass(portScript, "Password for 'https://git.example.com:443':"));
        assertNotEquals("secret",
            runAskPass(portScript, "Password for 'https://git.example.com:8443.evil.com':"));

        Path ipv6 = writeAskPassScript("[::1]");
        assertEquals("secret", runAskPass(ipv6, "Password for 'https://[::1]':"));
        assertEquals("secret", runAskPass(ipv6, "Password for 'https://[::1]:443':"));
        assertNotEquals("secret", runAskPass(ipv6, "Password for 'https://[::1]:444':"));

        Path ipv6Port = writeAskPassScript("[::1]:8443");
        assertEquals("secret", runAskPass(ipv6Port, "Password for 'https://[::1]:8443':"));
        assertNotEquals("secret", runAskPass(ipv6Port, "Password for 'https://[::1]:443':"));
    }

    private Path writeAskPassScript(String authority) throws Exception {
        Path script = Files.createFile(
            tempDir.resolve("askpass-" + authority.replace(':', '-') + ".sh"));
        Files.writeString(script, WorkspaceManager.askPassScript("secret", authority));
        Files.setPosixFilePermissions(script,
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        return script;
    }

    private String runAskPass(Path script, String prompt) throws Exception {
        Process process = new ProcessBuilder("sh", script.toString(), prompt)
            .redirectErrorStream(true)
            .start();
        String output = new String(
            process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        int exitCode = process.waitFor();
        return exitCode == 0 ? output : "";
    }

    @Test
    void normalizesTheTokenOrigin() {
        assertEquals("https://github.com",
            WorkspaceManager.httpsOrigin("https://GitHub.com/owner/repo.git"));
        assertEquals("https://github.com",
            WorkspaceManager.httpsOrigin("https://github.com:443/owner/repo.git"));
        assertEquals("https://git.example.com:8443",
            WorkspaceManager.httpsOrigin("https://git.example.com:8443/group/repo.git"));
        assertNull(WorkspaceManager.httpsOrigin("ssh://git@git.example.com/group/repo.git"));
        assertNull(WorkspaceManager.httpsOrigin(null));
    }

    @Test
    void legacyConstructionWithoutAnOriginKeepsTheOldBehaviour() {
        WorkspaceManager manager = new WorkspaceManager(
            "/tmp/ws", "repo", false, "token", () -> "token");

        assertTrue(manager.shouldAuthenticate("https://anything.example.com/repo.git"));
        assertTrue(manager.shouldAuthenticate("ssh://git@anything.example.com/repo.git"));
    }

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

    private static Object getField(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    private static void makeStale(Path path) throws IOException {
        Files.setLastModifiedTime(path, FileTime.from(
            Instant.now().minus(Duration.ofHours(48))));
    }

    @Test
    void pruneOnlyRemovesStaleGeneratedWorkspaceNames() throws Exception {
        WorkspaceManager manager = new WorkspaceManager(
            tempDir.toString(), "repo", false, null);
        Path stale = Files.createDirectory(tempDir.resolve("aaaaaaaa-repo"));
        Path fresh = Files.createDirectory(tempDir.resolve("bbbbbbbb-repo"));
        Path foreign = Files.createDirectory(tempDir.resolve("not-a-workspace"));
        Path file = Files.writeString(tempDir.resolve("keep.txt"), "x");
        makeStale(stale);
        makeStale(foreign);
        makeStale(file);

        int removed = manager.pruneStaleWorkspaces(Duration.ofHours(24));

        assertEquals(1, removed);
        assertFalse(Files.exists(stale));
        assertTrue(Files.exists(fresh));
        assertTrue(Files.exists(foreign));
        assertTrue(Files.exists(file));
    }

    @Test
    void pruneSkipsProtectedAndCurrentWorkspaces() throws Exception {
        WorkspaceManager manager = new WorkspaceManager(
            tempDir.toString(), "repo", false, null);
        Path protectedDir = Files.createDirectory(tempDir.resolve("cccccccc-repo"));
        Path current = Files.createDirectory(tempDir.resolve("dddddddd-repo"));
        makeStale(protectedDir);
        makeStale(current);
        setRepoDir(manager, current);

        int removed = manager.pruneStaleWorkspaces(
            Duration.ofHours(24), List.of(protectedDir.toString()));

        assertEquals(0, removed);
        assertTrue(Files.exists(protectedDir));
        assertTrue(Files.exists(current));
    }

    @Test
    void pruneFailsClosedForAnUnreadableProtectedPath() throws Exception {
        WorkspaceManager manager = new WorkspaceManager(
            tempDir.toString(), "repo", false, null);
        Path stale = Files.createDirectory(tempDir.resolve("eeeeeeee-repo"));
        makeStale(stale);

        int removed = manager.pruneStaleWorkspaces(
            Duration.ofHours(24), List.of("\u0000bad-path"));

        assertEquals(0, removed);
        assertTrue(Files.exists(stale));
    }

    @Test
    void pruneIsDisabledForZeroRetention() throws Exception {
        WorkspaceManager manager = new WorkspaceManager(
            tempDir.toString(), "repo", false, null);
        Path stale = Files.createDirectory(tempDir.resolve("ffffffff-repo"));
        makeStale(stale);

        assertEquals(0, manager.pruneStaleWorkspaces(Duration.ZERO));
        assertTrue(Files.exists(stale));
    }

    @Test
    void pruneDoesNotFollowSymlinkedWorkspaces() throws Exception {
        assumePosix();
        WorkspaceManager manager = new WorkspaceManager(
            tempDir.toString(), "repo", false, null);
        Path target = Files.createDirectory(tempDir.resolve("symlink-target"));
        Path link = tempDir.resolve("99999999-repo");
        Files.createSymbolicLink(link, target);
        makeStale(link);

        assertEquals(0, manager.pruneStaleWorkspaces(Duration.ofHours(24)));
        assertTrue(Files.exists(target, LinkOption.NOFOLLOW_LINKS));
        assertTrue(Files.isSymbolicLink(link));
    }

    @Test
    void pruneTempDirectoriesOnlyRemovesKnownStalePrefixes() throws Exception {
        WorkspaceManager manager = new WorkspaceManager(
            tempDir.toString(), "repo", false, null);
        Path tempRoot = Files.createDirectory(tempDir.resolve("tmp-root"));
        Path opencode = Files.createDirectory(tempRoot.resolve("opencode-harness-old"));
        Path askpass = Files.createDirectory(tempRoot.resolve("vibecode-askpass-old"));
        Path unrelated = Files.createDirectory(tempRoot.resolve("unrelated-old"));
        Path fresh = Files.createDirectory(tempRoot.resolve("opencode-harness-fresh"));
        makeStale(opencode);
        makeStale(askpass);
        makeStale(unrelated);

        int removed = manager.pruneStaleTempDirectories(tempRoot, Duration.ofHours(24));

        assertEquals(2, removed);
        assertFalse(Files.exists(opencode));
        assertFalse(Files.exists(askpass));
        assertTrue(Files.exists(unrelated));
        assertTrue(Files.exists(fresh));
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
    void cloneUsesTheCurrentTokenFromTheSourceAndRemovesAskpass() throws Exception {
        assumePosix();
        Path bin = Files.createDirectories(tempDir.resolve("fake-bin"));
        Path git = bin.resolve("git");
        Path capturedAskpass = tempDir.resolve("captured-askpass.sh");
        Path askpassPathFile = tempDir.resolve("askpass-path.txt");
        String script = "#!/bin/sh\n"
            + "while [ $# -gt 0 ] && [ \"$1\" != \"clone\" ] && [ \"$1\" != \"rev-parse\" ]; do shift; done\n"
            + "[ $# -eq 0 ] && exit 0\n"
            + "cmd=\"$1\"\n"
            + "shift\n"
            + "if [ \"$cmd\" = \"clone\" ]; then\n"
            + "  mkdir -p \"$2/.git\"\n"
            + "  printf '[core]\\n' > \"$2/.git/config\"\n"
            + "  [ -n \"$GIT_ASKPASS\" ] && printf '%s' \"$GIT_ASKPASS\" > '" + askpassPathFile + "'\n"
            + "  [ -n \"$GIT_ASKPASS\" ] && cp \"$GIT_ASKPASS\" '" + capturedAskpass + "'\n"
            + "  exit 0\n"
            + "fi\n"
            + "if [ \"$cmd\" = \"rev-parse\" ]; then echo 0123456789012345678901234567890123456789; exit 0; fi\n"
            + "exit 0\n";
        Files.writeString(git, script);
        Files.setPosixFilePermissions(git,
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));

        String[] token = {"ghs_first"};
        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "fake", false, null, () -> token[0]);
        setField(wm, "gitBinary", git.toString());

        wm.cloneRepo("https://git.example.com/owner/repo.git", "feature");

        assertTrue(Files.exists(capturedAskpass));
        assertTrue(Files.readString(capturedAskpass).contains("ghs_first"));
        Path askpass = Path.of(Files.readString(askpassPathFile));
        assertFalse(Files.exists(askpass.getParent()),
            "the token-bearing askpass directory was not removed");
    }

    @Test
    void cloneRefreshesAndRetriesAfterAuthenticationFailure() throws Exception {
        assumePosix();
        Path bin = Files.createDirectories(tempDir.resolve("fake-auth-bin"));
        Path git = bin.resolve("git");
        Path failedOnce = tempDir.resolve("clone-auth-failed-once");
        Path capturedAskpass = tempDir.resolve("clone-refreshed-askpass.sh");
        String script = "#!/bin/sh\n"
            + "while [ $# -gt 0 ] && [ \"$1\" != \"clone\" ] && [ \"$1\" != \"rev-parse\" ]; do shift; done\n"
            + "[ $# -eq 0 ] && exit 0\n"
            + "cmd=\"$1\"\n"
            + "shift\n"
            + "if [ \"$cmd\" = \"clone\" ]; then\n"
            + "  if [ ! -f '" + failedOnce + "' ]; then\n"
            + "    touch '" + failedOnce + "'\n"
            + "    mkdir -p \"$2/.git\"\n"
            + "    echo partial > \"$2/.git/partial-clone\"\n"
            + "    echo 'fatal: Authentication failed for repo' >&2\n"
            + "    exit 1\n"
            + "  fi\n"
            + "  mkdir -p \"$2/.git\"\n"
            + "  printf '[core]\\n' > \"$2/.git/config\"\n"
            + "  [ -n \"$GIT_ASKPASS\" ] && cp \"$GIT_ASKPASS\" '" + capturedAskpass + "'\n"
            + "  exit 0\n"
            + "fi\n"
            + "if [ \"$cmd\" = \"rev-parse\" ]; then echo 0123456789012345678901234567890123456789; exit 0; fi\n"
            + "exit 0\n";
        Files.writeString(git, script);
        Files.setPosixFilePermissions(git,
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));

        final int[] refreshes = {0};
        GitHubTokenSource source = new GitHubTokenSource() {
            @Override
            public String get() {
                return "ghs_first";
            }

            @Override
            public String refresh() {
                refreshes[0] += 1;
                return "ghs_refreshed";
            }
        };
        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "fake-auth", false, null, source);
        setField(wm, "gitBinary", git.toString());

        wm.cloneRepo("https://github.com/owner/repo.git", "feature");

        assertEquals(1, refreshes[0]);
        assertTrue(Files.readString(capturedAskpass).contains("ghs_refreshed"));
        assertFalse(Files.exists(wm.getRepoDir().resolve(".git/partial-clone")),
            "a partial clone destination was not removed before retrying");
    }

    @Test
    void authenticationFailureMatchingIsNarrow() {
        assertTrue(WorkspaceManager.isAuthenticationFailure(
            "fatal: Authentication failed for 'https://github.com/o/r.git/'"));
        assertTrue(WorkspaceManager.isAuthenticationFailure(
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled"));
        assertTrue(WorkspaceManager.isAuthenticationFailure(
            "remote: HTTP 401"));
        assertFalse(WorkspaceManager.isAuthenticationFailure(
            "remote: HTTP 403"));
        assertFalse(WorkspaceManager.isAuthenticationFailure(
            "! [remote rejected] feature (protected branch hook declined)"));
        assertFalse(WorkspaceManager.isAuthenticationFailure(
            "fatal: repository not found"));
    }

    @Test
    void cloneDoesNotRefreshOnANonAuthenticationFailure() throws Exception {
        assumePosix();
        Path bin = Files.createDirectories(tempDir.resolve("fake-missing-bin"));
        Path git = bin.resolve("git");
        String script = "#!/bin/sh\n"
            + "while [ $# -gt 0 ] && [ \"$1\" != \"clone\" ]; do shift; done\n"
            + "[ $# -eq 0 ] && exit 0\n"
            + "echo 'fatal: repository not found' >&2\n"
            + "exit 1\n";
        Files.writeString(git, script);
        Files.setPosixFilePermissions(git,
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));

        final int[] refreshes = {0};
        GitHubTokenSource source = new GitHubTokenSource() {
            @Override
            public String get() {
                return "ghs_first";
            }

            @Override
            public String refresh() {
                refreshes[0] += 1;
                return "ghs_refreshed";
            }
        };
        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "fake-missing", false, null, source);
        setField(wm, "gitBinary", git.toString());

        assertThrows(IOException.class,
            () -> wm.cloneRepo("https://github.com/owner/missing.git", "feature"));
        assertEquals(0, refreshes[0]);
    }

    @Test
    void pushRefreshesAndRetriesAfterAuthenticationFailure() throws Exception {
        assumePosix();
        Path repoDir = Files.createDirectories(tempDir.resolve("push-repo"));
        Files.createDirectories(repoDir.resolve(".git"));
        Path bin = Files.createDirectories(tempDir.resolve("fake-push-bin"));
        Path git = bin.resolve("git");
        Path failedOnce = tempDir.resolve("push-auth-failed-once");
        Path capturedAskpass = tempDir.resolve("push-refreshed-askpass.sh");
        String script = "#!/bin/sh\n"
            + "while [ $# -gt 0 ] && [ \"$1\" != \"ls-remote\" ] && [ \"$1\" != \"push\" ]; do shift; done\n"
            + "[ $# -eq 0 ] && exit 0\n"
            + "cmd=\"$1\"\n"
            + "shift\n"
            + "if [ \"$cmd\" = \"ls-remote\" ]; then exit 0; fi\n"
            + "if [ \"$cmd\" = \"push\" ]; then\n"
            + "  if [ ! -f '" + failedOnce + "' ]; then\n"
            + "    touch '" + failedOnce + "'\n"
            + "    echo 'fatal: Authentication failed for repo' >&2\n"
            + "    exit 1\n"
            + "  fi\n"
            + "  [ -n \"$GIT_ASKPASS\" ] && cp \"$GIT_ASKPASS\" '" + capturedAskpass + "'\n"
            + "  exit 0\n"
            + "fi\n"
            + "exit 0\n";
        Files.writeString(git, script);
        Files.setPosixFilePermissions(git,
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));

        final int[] refreshes = {0};
        GitHubTokenSource source = new GitHubTokenSource() {
            @Override
            public String get() {
                return "ghs_first";
            }

            @Override
            public String refresh() {
                refreshes[0] += 1;
                return "ghs_refreshed";
            }
        };
        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "fake-push", false, null, source);
        setField(wm, "gitBinary", git.toString());
        setRepoDir(wm, repoDir);

        Method push = WorkspaceManager.class.getDeclaredMethod(
            "pushCommit", String.class, String.class);
        push.setAccessible(true);
        push.invoke(wm, "abc123", "feature");

        assertEquals(1, refreshes[0]);
        assertTrue(Files.readString(capturedAskpass).contains("ghs_refreshed"));
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
    void stageFreshDiffReportsModifiedAndUntrackedFiles() throws Exception {
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

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("tracked.txt") && file.status().equals("modified")));
        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("new.txt") && file.status().equals("added")));
        assertEquals(3, diff.additions());
        assertEquals(0, diff.deletions());
    }

    @Test
    void stageFreshDiffExpandsNewDirectoriesSoProtectedFilesCannotHide() throws Exception {
        Path repoDir = initRepo("untracked-dirs");
        java.nio.file.Files.createDirectories(repoDir.resolve(".github/workflows"));
        java.nio.file.Files.createDirectories(repoDir.resolve("cfg"));
        Files.writeString(repoDir.resolve(".github/workflows/evil.yml"),
            "name: evil\non: push\n");
        Files.writeString(repoDir.resolve("cfg/.env"), "SECRET=value\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }
        List<String> paths = diff.files().stream().map(DiffSummary.ChangedFile::path).toList();

        assertTrue(paths.contains(".github/workflows/evil.yml"), "paths=" + paths);
        assertTrue(paths.contains("cfg/.env"), "paths=" + paths);
        assertFalse(paths.contains(".github/"));
        assertFalse(paths.contains("cfg/"));
        assertEquals(3, diff.additions());
        assertTrue(diff.changedBytes() > 0);
    }

    @Test
    void stageFreshDiffCountsBinaryUntrackedFilesWithoutThrowing() throws Exception {
        Path repoDir = initRepo("binary");
        byte[] binary = new byte[]{0x00, (byte) 0xff, 0x10, 0x0a, (byte) 0x80};
        Files.write(repoDir.resolve("fixture.bin"), binary);

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = assertDoesNotThrow(wm::stageFreshDiff);
        } finally {
            wm.discardStaged();
        }

        assertTrue(diff.files().stream().anyMatch(file -> file.path().equals("fixture.bin")));
        assertTrue(diff.changedBytes() >= binary.length);
    }

    @Test
    void stageFreshDiffUsesTheWorktreeNotTheAgentIndex() throws Exception {
        Path repoDir = initRepo("staged");
        Files.writeString(repoDir.resolve("README.md"), "initial\nchanged\n");
        Files.writeString(repoDir.resolve("added.txt"), "one\ntwo\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        wm.stageAll();

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

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
        DiffSummary diff = wm.stageFreshDiff();
        new PublishingGuard(List.of(".env*", "**/.env*", "Jenkinsfile", ".github/**"))
            .assertPublishable(diff);

        wm.commitAndPushStaged("feat: e2e", "vibecode/ticket-1-e2e");
        wm.discardStaged();

        runGit(bare, "rev-parse", "--verify", "refs/heads/vibecode/ticket-1-e2e");
        assertEquals(1, diff.files().stream()
            .filter(file -> file.path().equals("feature.txt")).count());
    }


    @Test
    void worktreeTreeIdDetectsDirtyContentAndUntrackedSourceChanges() throws Exception {
        Path source = initRepo("tree-source");
        Path bare = initBare("tree-remote.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "tree", false, null);
        wm.cloneRepo(bare.toString(), "vibecode/ticket-tree");

        Path readme = wm.getRepoDir().resolve("README.md");
        Files.writeString(readme, "already dirty one\n");
        String first = wm.worktreeTreeId();
        Files.writeString(readme, "already dirty two\n");
        String second = wm.worktreeTreeId();
        assertNotEquals(first, second, "a dirty file content change must change the tree");

        String beforeUntracked = wm.worktreeTreeId();
        Files.writeString(wm.getRepoDir().resolve("new-source.js"), "export default 1;\n");
        assertNotEquals(beforeUntracked, wm.worktreeTreeId(),
            "an untracked non-ignored file must change the tree");
    }

    @Test
    void worktreeTreeIdAllowsIgnoredTestData() throws Exception {
        Path source = initRepo("tree-ignored-source");
        Files.writeString(source.resolve(".gitignore"), "test-data/\n");
        runGit(source, "add", ".gitignore");
        runGit(source, "commit", "-m", "ignore test data");
        Path bare = initBare("tree-ignored-remote.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "tree-ignored", false, null);
        wm.cloneRepo(bare.toString(), "vibecode/ticket-tree-ignored");
        String before = wm.worktreeTreeId();
        Files.createDirectories(wm.getRepoDir().resolve("test-data"));
        Files.writeString(wm.getRepoDir().resolve("test-data/seed.txt"), "seed\n");
        assertEquals(before, wm.worktreeTreeId(), "ignored test data must not be published");
    }

    @Test
    void worktreeTreeIdIgnoresAssumeUnchangedIndexFlags() throws Exception {
        Path source = initRepo("tree-assume-source");
        Path bare = initBare("tree-assume-remote.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "tree-assume", false, null);
        wm.cloneRepo(bare.toString(), "vibecode/ticket-tree-assume");
        runGit(wm.getRepoDir(), "update-index", "--assume-unchanged", "README.md");
        String before = wm.worktreeTreeId();
        Files.writeString(wm.getRepoDir().resolve("README.md"), "changed despite flag\n");
        assertNotEquals(before, wm.worktreeTreeId(),
            "the temporary index must see content hidden by assume-unchanged");
    }

    @Test
    void cloneRepoHonorsAnExplicitCloneTimeout() throws Exception {
        assumePosix();
        Path git = tempDir.resolve("slow-git.sh");
        Files.writeString(git, "#!/bin/sh\nsleep 30\n");
        Files.setPosixFilePermissions(git,
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "timeout", false, null);
        setField(wm, "gitBinary", git.toString());

        IOException error = assertThrows(IOException.class, () -> wm.cloneRepo(
            "https://example.invalid/repo.git", "feature", null, Duration.ofMillis(300)));

        assertTrue(error.getMessage().contains("timed out"), error.getMessage());
    }

    @Test
    void cloneRepoChecksOutAnExplicitBaseBranchAndPinsIt() throws Exception {
        Path source = initRepo("base-source");
        Path bare = initBare("base-remote.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(source, "checkout", "-b", "develop");
        Files.writeString(source.resolve("DEVELOP.md"), "from develop\n");
        runGit(source, "add", "DEVELOP.md");
        runGit(source, "commit", "-m", "develop commit");
        runGit(source, "push", "origin", "HEAD:refs/heads/develop");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "base", false, null);
        wm.cloneRepo(bare.toString(), "vibecode/ticket-1-base", "develop");

        assertEquals("from develop",
            Files.readString(wm.getRepoDir().resolve("DEVELOP.md")).trim());
        assertEquals(gitOutput(bare, "rev-parse", "refs/heads/develop"),
            wm.getBaseCommit());
    }

    @Test
    void cloneRepoFailsClosedWhenTheProfileBaseBranchIsMissing() throws Exception {
        Path source = initRepo("missing-base-source");
        Path bare = initBare("missing-base-remote.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "base", false, null);

        assertThrows(IOException.class,
            () -> wm.cloneRepo(bare.toString(), "vibecode/ticket-1-base", "does-not-exist"));
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
    void guardedChangedBlobsExposeContentDespiteGitAttributesAndBinaryFiles() throws Exception {
        Path repoDir = initRepo("guarded-blob-attributes");
        String secret = "oc_sk_live_1234567890";
        Files.writeString(repoDir.resolve(".gitattributes"), "* -diff\n");
        Files.writeString(repoDir.resolve("README.md"), "token: " + secret + "\n");
        Files.write(repoDir.resolve("secret.bin"),
            ("prefix\0" + secret + "\0suffix").getBytes(StandardCharsets.ISO_8859_1));

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        SecretLeakGuard guard = new SecretLeakGuard(List.of(secret));

        DiffSummary diff = wm.stageFreshDiff();
        try {
            new PublishingGuard(List.of()).assertPublishable(diff);
            assertTrue(wm.guardedChangedBlobs().stream()
                    .anyMatch(blob -> blob.path().equals("README.md")
                        && new String(blob.content(), StandardCharsets.ISO_8859_1).contains(secret)),
                "guarded blob scan did not see README content");
            assertTrue(wm.guardedChangedBlobs().stream()
                    .anyMatch(blob -> blob.path().equals("secret.bin")
                        && new String(blob.content(), StandardCharsets.ISO_8859_1).contains(secret)),
                "guarded blob scan did not see binary content");
            assertThrows(IllegalStateException.class,
                () -> guard.assertClean(wm.guardedChangedBlobs()));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void guardedChangedBlobsDetectPlusPrefixedLinesAndSecretFilenames() throws Exception {
        Path repoDir = initRepo("guarded-blob-plus");
        String secret = "oc_sk_live_1234567890";
        Files.writeString(repoDir.resolve("plus.txt"), "++" + secret + "\n");
        Files.writeString(repoDir.resolve("docs-" + secret + ".txt"), "ordinary\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        SecretLeakGuard guard = new SecretLeakGuard(List.of(secret));

        DiffSummary diff = wm.stageFreshDiff();
        try {
            new PublishingGuard(List.of()).assertPublishable(diff);
            assertThrows(IllegalStateException.class,
                () -> guard.assertClean(wm.guardedChangedBlobs()));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void guardedChangedBlobsIgnorePreExistingFixturesInModifiedFiles() throws Exception {
        Path repoDir = initRepo("guarded-blob-fixture");
        String fixture = "const key = \"sk-ant-api03-long-token-1234567890\";\n";
        Files.writeString(repoDir.resolve("config.js"), fixture);
        runGit(repoDir, "add", ".");
        runGit(repoDir, "commit", "-m", "fixture");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        SecretLeakGuard guard = new SecretLeakGuard(List.of());
        Files.writeString(repoDir.resolve("config.js"), fixture + "// unrelated change\n");
        DiffSummary diff = wm.stageFreshDiff();
        try {
            new PublishingGuard(List.of()).assertPublishable(diff);
            guard.assertClean(wm.guardedChangedBlobs());
        } finally {
            wm.discardStaged();
        }

        Files.writeString(repoDir.resolve("config.js"),
            fixture + "// unrelated change\n"
                + "const token = \"ghp_abcdefghijklmnopqrstuvwxyz0123456789\";\n");
        diff = wm.stageFreshDiff();
        try {
            new PublishingGuard(List.of()).assertPublishable(diff);
            assertThrows(IllegalStateException.class,
                () -> guard.assertClean(wm.guardedChangedBlobs()));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void guardedChangedBlobsIgnorePreExistingCredentialPathsButBlockNewOnes() throws Exception {
        Path repoDir = initRepo("guarded-blob-path-fixture");
        String secret = "oc_sk_live_1234567890";
        Path fixtureDir = Files.createDirectories(repoDir.resolve("fixtures"));
        Path fixture = fixtureDir.resolve(secret + ".txt");
        Files.writeString(fixture, "ordinary\n");
        runGit(repoDir, "add", ".");
        runGit(repoDir, "commit", "-m", "fixture path");

        Files.writeString(fixture, "ordinary\nchanged\n");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        SecretLeakGuard guard = new SecretLeakGuard(List.of(secret));
        DiffSummary diff = wm.stageFreshDiff();
        try {
            new PublishingGuard(List.of()).assertPublishable(diff);
            assertTrue(wm.guardedChangedBlobs().stream()
                .anyMatch(blob -> blob.path().contains(secret) && !blob.newPath()));
            guard.assertClean(wm.guardedChangedBlobs());
        } finally {
            wm.discardStaged();
        }

        Files.writeString(repoDir.resolve("new-" + secret + ".txt"), "ordinary\n");
        diff = wm.stageFreshDiff();
        try {
            assertThrows(IllegalStateException.class,
                () -> guard.assertClean(wm.guardedChangedBlobs()));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void guardedChangedBlobsExposeNewGitlinkPathsForScanning() throws Exception {
        Path repoDir = initRepo("guarded-gitlink");
        String secret = "oc_sk_live_1234567890";
        Path submodule = repoDir.resolve("submodule-" + secret);
        Files.createDirectories(submodule);
        runGit(submodule, "init");
        runGit(submodule, "config", "user.email", "test@example.com");
        runGit(submodule, "config", "user.name", "Test User");
        Files.writeString(submodule.resolve("nested.txt"), "nested\n");
        runGit(submodule, "add", ".");
        runGit(submodule, "commit", "-m", "nested");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        SecretLeakGuard guard = new SecretLeakGuard(List.of(secret));
        DiffSummary diff = wm.stageFreshDiff();
        try {
            new PublishingGuard(List.of()).assertPublishable(diff);
            assertTrue(wm.guardedChangedBlobs().stream()
                    .anyMatch(blob -> blob.path().contains(secret)),
                "new gitlink path was not exposed to the scanner");
            assertThrows(IllegalStateException.class,
                () -> guard.assertClean(wm.guardedChangedBlobs()));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void guardedChangedBlobsHandleAGitlinkToFileTypeChange() throws Exception {
        Path repoDir = initRepo("guarded-gitlink-to-file");
        String head = gitOutput(repoDir, "rev-parse", "HEAD");
        runGit(repoDir, "update-index", "--add", "--cacheinfo", "160000," + head + ",submodule");
        runGit(repoDir, "commit", "-m", "gitlink");
        runGit(repoDir, "rm", "--cached", "submodule");

        String secret = "oc_sk_live_1234567890";
        Files.writeString(repoDir.resolve("submodule"), "token: " + secret + "\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        SecretLeakGuard guard = new SecretLeakGuard(List.of(secret));
        DiffSummary diff = wm.stageFreshDiff();
        try {
            new PublishingGuard(List.of()).assertPublishable(diff);
            assertTrue(wm.guardedChangedBlobs().stream()
                    .anyMatch(blob -> blob.path().equals("submodule")
                        && new String(blob.content(), StandardCharsets.UTF_8).contains(secret)),
                "gitlink->file type change content was not scanned");
            assertThrows(IllegalStateException.class,
                () -> guard.assertClean(wm.guardedChangedBlobs()));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void guardedChangedBlobsRequireAGuardedTree() throws Exception {
        Path repoDir = initRepo("guarded-blob-unguarded");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        assertThrows(IOException.class, wm::guardedChangedBlobs);
    }

    @Test
    void hugeBlobLineCountingIsBoundedByBytes() throws Exception {
        Path repoDir = initRepo("huge-blob");
        String huge = "\u0000" + "x".repeat(11 * 1024 * 1024);
        Files.writeString(repoDir.resolve("huge.bin"), huge);

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertTrue(diff.changedBytes() >= 11L * 1024 * 1024);
        assertEquals(0, diff.additions());
    }

    @Test
    void stageFreshDiffCountsAddedPlusRemovedContentBytes() throws Exception {
        Path repoDir = initRepo("byte-semantics");
        Files.writeString(repoDir.resolve("data.txt"), "1234567890\n");
        runGit(repoDir, "add", "data.txt");
        runGit(repoDir, "commit", "-m", "add data");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        Files.writeString(repoDir.resolve("data.txt"), "123\n");
        DiffSummary shrunk;
        try {
            shrunk = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }
        assertEquals(11, shrunk.changedBytes(),
            "shrunk file must count new content plus removed bytes");

        Files.writeString(repoDir.resolve("data.txt"), "12345678901234567890\n");
        DiffSummary grown;
        try {
            grown = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }
        assertEquals(21, grown.changedBytes(),
            "grown file must count its new content without double-counting unchanged bytes");
    }

    @Test
    void stageFreshDiffCountsDeletedOversizeBlobBytes() throws Exception {
        Path repoDir = initRepo("deleted-huge-blob");
        Files.writeString(repoDir.resolve("huge.txt"), "x".repeat(11 * 1024 * 1024));
        runGit(repoDir, "add", "huge.txt");
        runGit(repoDir, "commit", "-m", "huge");
        Files.delete(repoDir.resolve("huge.txt"));

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("huge.txt") && file.status().equals("deleted")));
        assertEquals(11L * 1024 * 1024, diff.changedBytes(),
            "deleted blob bytes must count even above the line-count scan limit");
    }

    @Test
    void stageFreshDiffCountsRemovedBytesWhenLargeBinaryShrinks() throws Exception {
        Path repoDir = initRepo("shrunk-large-binary");
        byte[] original = new byte[12 * 1024 * 1024];
        Arrays.fill(original, (byte) 0x7f);
        original[0] = 0;
        Files.write(repoDir.resolve("asset.bin"), original);
        runGit(repoDir, "add", "asset.bin");
        runGit(repoDir, "commit", "-m", "large binary");

        byte[] shrunk = new byte[1 * 1024 * 1024];
        Arrays.fill(shrunk, (byte) 0x7f);
        shrunk[0] = 0;
        Files.write(repoDir.resolve("asset.bin"), shrunk);

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertTrue(diff.files().stream().anyMatch(
            file -> file.path().equals("asset.bin") && file.status().equals("modified")));
        assertEquals(12L * 1024 * 1024, diff.changedBytes(),
            "shrunk binary must count its new size plus the removed delta");
        assertEquals(0, diff.additions(), "binary line counts are not meaningful");
    }

    @Test
    void oversizedDiffAttributeTextFailsClosedForLinesWithRaisedByteLimit() throws Exception {
        Path repoDir = initRepo("huge-diff-attribute");
        Files.writeString(repoDir.resolve(".gitattributes"), "* -diff\n");
        String content = "line\n".repeat((11 * 1024 * 1024) / 5 + 1);
        Files.writeString(repoDir.resolve("huge.txt"), content);
        runGit(repoDir, "add", ".gitattributes", "huge.txt");
        runGit(repoDir, "commit", "-m", "huge text with -diff");

        Files.writeString(repoDir.resolve("huge.txt"), content + "extra\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertTrue(diff.changedBytes() > 10L * 1024 * 1024,
            "oversized -diff text bytes must be counted");
        assertTrue(diff.additions() > 1_000_000,
            "oversized -diff text must fail closed instead of reporting zero lines");
        PublishingGuard guard = new PublishingGuard(List.of(), 50, 2_000, 20L * 1024 * 1024);
        assertThrows(IllegalStateException.class, () -> guard.assertPublishable(diff),
            "the line guard must still reject the diff when only the byte limit is raised");
    }

    @Test
    void oversizedDiffAttributeTextShrinkFailsClosedForLinesWithRaisedByteLimit() throws Exception {
        Path repoDir = initRepo("huge-diff-attribute-shrink");
        Files.writeString(repoDir.resolve(".gitattributes"), "* -diff\n");
        String content = "line\n".repeat((11 * 1024 * 1024) / 5 + 1);
        Files.writeString(repoDir.resolve("huge.txt"), content);
        runGit(repoDir, "add", ".gitattributes", "huge.txt");
        runGit(repoDir, "commit", "-m", "huge text with -diff");

        Files.writeString(repoDir.resolve("huge.txt"), "small\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertEquals(1, diff.additions());
        assertTrue(diff.deletions() > 1_000_000,
            "removed lines from the old -diff text blob must be counted");
        assertTrue(diff.changedBytes() > 10L * 1024 * 1024,
            "shrunk -diff text bytes must count the old content");
        PublishingGuard guard = new PublishingGuard(List.of(), 50, 2_000, 20L * 1024 * 1024);
        assertThrows(IllegalStateException.class, () -> guard.assertPublishable(diff),
            "the line guard must reject a shrinking -diff text diff when only the byte limit is raised");
    }

    @Test
    void smallDiffAttributeGrowDoesNotDoubleCountTheOldBlob() throws Exception {
        Path repoDir = initRepo("small-diff-attribute-grow");
        Files.writeString(repoDir.resolve(".gitattributes"), "* -diff\n");
        String original = "line\n".repeat(1_500);
        Files.writeString(repoDir.resolve("small.txt"), original);
        runGit(repoDir, "add", ".gitattributes", "small.txt");
        runGit(repoDir, "commit", "-m", "small text with -diff");

        Files.writeString(repoDir.resolve("small.txt"), original + "extra\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertEquals(1_501, diff.additions());
        assertEquals(0, diff.deletions(),
            "a small grow must not count the whole old blob as removed");
        assertTrue(diff.changedLines() < 2_000);
    }

    @Test
    void smallBinaryBlobReportsZeroLines() throws Exception {
        Path repoDir = initRepo("small-binary-lines");
        Files.write(repoDir.resolve("asset.bin"), new byte[]{0x00, '\n', '\n'});

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertEquals(0, diff.additions(), "binary newlines must not count as text lines");
        assertTrue(diff.changedBytes() >= 3);
    }

    @Test
    void stageFreshDiffIgnoresIndexOnlyBlobs() throws Exception {
        Path repoDir = initRepo("index-only-bytes");
        String big = "x".repeat(20_000);
        String sha = gitOutputWithInput(repoDir, big, "hash-object", "-w", "--stdin");
        runGit(repoDir, "update-index", "--add", "--cacheinfo", "100644," + sha + ",big.txt");
        runGit(repoDir, "update-index", "--assume-unchanged", "big.txt");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff;
        try {
            diff = wm.stageFreshDiff();
        } finally {
            wm.discardStaged();
        }

        assertTrue(diff.files().stream().noneMatch(file -> file.path().equals("big.txt")),
            "agent-controlled index-only entries must not enter the guarded tree");
    }

    @Test
    void maliciousLocalHeadCannotHideProtectedFilesFromTheGuard() throws Exception {
        Path repoDir = initRepo("malicious-head");
        String base = gitOutput(repoDir, "rev-parse", "HEAD");

        // Agent-authored commit containing a protected file, then HEAD points
        // at it while the worktree matches.
        Files.writeString(repoDir.resolve("Jenkinsfile"), "evil = true\n");
        runGit(repoDir, "add", "Jenkinsfile");
        runGit(repoDir, "commit", "-m", "malicious base");
        Files.writeString(repoDir.resolve("README.md"), "initial\nnormal edit\n");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        setField(wm, "baseCommit", base);

        DiffSummary diff = wm.stageFreshDiff();
        try {
            assertTrue(diff.files().stream().anyMatch(
                file -> file.path().equals("Jenkinsfile") && file.status().equals("added")),
                "protected file from malicious HEAD was not surfaced: " + diff.files());
            PublishingGuard guard = new PublishingGuard(
                List.of(".env*", "**/.env*", "Jenkinsfile", ".github/**"));
            assertThrows(IllegalStateException.class, () -> guard.assertPublishable(diff));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void mutatingTheTempIndexAfterGuardCannotChangeThePublishedTree() throws Exception {
        Path repoDir = initRepo("temp-index-mutation");
        Path bare = initBare("temp-index-mutation.git");
        runGit(repoDir, "remote", "add", "origin", bare.toString());
        String trustedConfig = Files.readString(repoDir.resolve(".git/config"));
        String base = gitOutput(repoDir, "rev-parse", "HEAD");

        Files.writeString(repoDir.resolve("feature.txt"), "guarded\n");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        setField(wm, "trustedGitConfig", trustedConfig);
        setField(wm, "baseCommit", base);

        DiffSummary diff = wm.stageFreshDiff();
        new PublishingGuard(List.of()).assertPublishable(diff);

        Path index = (Path) getField(wm, "supervisorIndex");
        String evilSha = gitOutputWithInput(repoDir, "evil\n", "hash-object", "-w", "--stdin");
        runGitWithIndex(repoDir, index, "update-index", "--add",
            "--cacheinfo", "100644," + evilSha + ",.github/workflows/evil.yml");

        wm.commitAndPushStaged("feat: guarded tree", "feature");
        wm.discardStaged();

        String tree = gitOutput(bare, "ls-tree", "-r", "--name-only", "refs/heads/feature");
        assertFalse(tree.contains(".github/workflows/evil.yml"),
            "temp-index mutation leaked into the published tree: " + tree);
        assertEquals("guarded", gitOutput(bare, "show", "refs/heads/feature:feature.txt"));
    }

    @Test
    void failedStagingClearsSupervisorState() throws Exception {
        Path repoDir = initRepo("staging-failure");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);
        setField(wm, "baseCommit", "0000000000000000000000000000000000000000");

        assertThrows(IOException.class, () -> wm.commitAndPush("test", "feature"));
        assertNull(getField(wm, "supervisorIndex"));
        assertNull(getField(wm, "guardedTree"));
    }

    @Test
    void submodulePointersDoNotBreakDiffCollection() throws Exception {
        Path repoDir = initRepo("submodule");
        Path nested = repoDir.resolve("sub");
        Files.createDirectories(nested);
        runGit(nested, "init");
        runGit(nested, "config", "user.email", "test@example.com");
        runGit(nested, "config", "user.name", "Test User");
        Files.writeString(nested.resolve("file.txt"), "nested\n");
        runGit(nested, "add", ".");
        runGit(nested, "commit", "-m", "nested");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        DiffSummary diff = assertDoesNotThrow(wm::stageFreshDiff);
        try {
            assertTrue(diff.files().stream().anyMatch(file -> file.path().equals("sub")));
        } finally {
            wm.discardStaged();
        }
    }

    @Test
    void legacyWriteFilesRejectGitAndCiControlPaths() throws Exception {
        Path repoDir = initRepo("legacy-protected");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        for (String path : List.of(
            ".git/HEAD", ".git/config", ".git/hooks/pre-commit",
            "Jenkinsfile", ".github/workflows/ci.yml", "backend/.env"
        )) {
            FileOperation op = new FileOperation(path, "evil", FileOperation.Action.CREATE);
            assertThrows(IOException.class, () -> wm.writeFiles(List.of(op)),
                "Expected " + path + " to be rejected");
        }

        FileOperation example = new FileOperation(
            "backend/.env.example", "SAFE=example", FileOperation.Action.CREATE);
        assertDoesNotThrow(() -> wm.writeFiles(List.of(example)));
        assertTrue(Files.exists(repoDir.resolve("backend/.env.example")));
    }

    @Test
    void fsckOptOutIsRecognized() {
        assertTrue(WorkspaceManager.fsckEnabled(null));
        assertTrue(WorkspaceManager.fsckEnabled(""));
        assertTrue(WorkspaceManager.fsckEnabled("true"));
        assertTrue(WorkspaceManager.fsckEnabled("1"));
        assertFalse(WorkspaceManager.fsckEnabled("false"));
        assertFalse(WorkspaceManager.fsckEnabled("0"));
        assertFalse(WorkspaceManager.fsckEnabled(" FALSE "));
    }

    @Test
    void fsckDisabledLogsAWarningAndEnabledPathRuns() throws Exception {
        Path repoDir = initRepo("fsck-warning");
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        Logger logger = (Logger) LoggerFactory.getLogger(WorkspaceManager.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            wm.checkObjectIntegrity("false");
            assertTrue(appender.list.stream().anyMatch(event ->
                    event.getFormattedMessage().contains("HARNESS_FSCK=false")),
                "disabled fsck must warn");
            wm.checkObjectIntegrity("true");
        } finally {
            logger.detachAppender(appender);
        }
    }

    @Test
    void legacyWriteFilesRejectExactProtectedDirectoryDeletes() throws Exception {
        Path repoDir = initRepo("legacy-protected-empty-dirs");
        Path github = Files.createDirectories(repoDir.resolve(".github"));
        Path secrets = Files.createDirectories(repoDir.resolve("secrets"));
        Path nestedGithub = Files.createDirectories(repoDir.resolve("sub/.github"));
        Path nestedSecrets = Files.createDirectories(repoDir.resolve("sub/secrets"));

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        for (String path : List.of(".github", "secrets", "sub/.github", "sub/secrets")) {
            FileOperation op = new FileOperation(path, null, FileOperation.Action.DELETE);
            assertThrows(IOException.class, () -> wm.writeFiles(List.of(op)),
                "Expected exact protected directory delete to be rejected: " + path);
        }

        assertTrue(Files.exists(github));
        assertTrue(Files.exists(secrets));
        assertTrue(Files.exists(nestedGithub));
        assertTrue(Files.exists(nestedSecrets));
    }

    @Test
    void legacyWriteFilesRejectsSymlinksThatPointAtProtectedDirectories() throws Exception {
        assumePosix();
        Path repoDir = initRepo("legacy-protected-symlinks");
        Files.createDirectories(repoDir.resolve(".github/workflows"));
        Path secrets = Files.createDirectories(repoDir.resolve("secrets"));
        Files.writeString(secrets.resolve("key"), "secret");
        Files.createSymbolicLink(repoDir.resolve("gitlink"), repoDir.resolve(".git"));
        Files.createSymbolicLink(repoDir.resolve("cilink"), repoDir.resolve(".github"));
        Files.createSymbolicLink(repoDir.resolve("secretlink"), repoDir.resolve("secrets"));

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        setRepoDir(wm, repoDir);

        for (String path : List.of(
            "gitlink/HEAD",
            "cilink/workflows/ci.yml",
            "secretlink/key"
        )) {
            FileOperation op = new FileOperation(path, "evil", FileOperation.Action.MODIFY);
            assertThrows(IOException.class, () -> wm.writeFiles(List.of(op)),
                "Expected symlinked protected path to be rejected: " + path);
        }

        FileOperation delete = new FileOperation(
            "secretlink/key", null, FileOperation.Action.DELETE);
        assertThrows(IOException.class, () -> wm.writeFiles(List.of(delete)));
        assertTrue(Files.exists(secrets.resolve("key")));
        assertEquals("secret", Files.readString(secrets.resolve("key")));
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
    void stageFreshDiffWithoutWorkspaceFailsClosed() {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);

        assertThrows(IOException.class, wm::stageFreshDiff);
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

    private static void runGitWithIndex(Path directory, Path index, String... args) throws Exception {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.addAll(List.of(args));
        ProcessBuilder builder = new ProcessBuilder(command)
            .directory(directory.toFile())
            .redirectErrorStream(true);
        builder.environment().put("GIT_INDEX_FILE", index.toString());
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        assertEquals(0, exit, "git " + String.join(" ", args) + " failed: " + output);
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

    @Test
    void publishFastForwardPushesWhenTheRemoteIsStillAtTheReviewedSha() throws Exception {
        Path source = initRepo("ff-source");
        Path bare = initBare("ff.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");
        runGit(source, "push", "origin", "HEAD:refs/heads/vibecode/fix");
        String reviewedSha = gitOutput(source, "rev-parse", "HEAD");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "ff", false, null);
        wm.cloneRepo(bare.toString(), "vibecode/fix");
        Path repoDir = wm.getRepoDir();
        runGit(repoDir, "config", "user.email", "fix@example.com");
        runGit(repoDir, "config", "user.name", "Fixer");
        Files.writeString(repoDir.resolve("fix.txt"), "fixed\n");
        runGit(repoDir, "add", ".");
        runGit(repoDir, "commit", "-m", "fix review findings");
        String fixedSha = gitOutput(repoDir, "rev-parse", "HEAD");

        // A short commit id is resolved to the full object id before publishing.
        assertEquals(fixedSha,
            wm.publishFastForward(fixedSha.substring(0, 12), "vibecode/fix", reviewedSha));
        assertEquals(fixedSha,
            gitOutput(bare, "rev-parse", "refs/heads/vibecode/fix"));
    }

    @Test
    void publishFastForwardAbortsWhenAHumanPushedTheBranch() throws Exception {
        Path source = initRepo("ff-moved-source");
        Path bare = initBare("ff-moved.git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");
        runGit(source, "push", "origin", "HEAD:refs/heads/vibecode/fix");
        String reviewedSha = gitOutput(source, "rev-parse", "HEAD");

        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "ff-moved", false, null);
        wm.cloneRepo(bare.toString(), "vibecode/fix");
        Path repoDir = wm.getRepoDir();
        runGit(repoDir, "config", "user.email", "fix@example.com");
        runGit(repoDir, "config", "user.name", "Fixer");
        Files.writeString(repoDir.resolve("fix.txt"), "fixed\n");
        runGit(repoDir, "add", ".");
        runGit(repoDir, "commit", "-m", "fix review findings");
        String fixedSha = gitOutput(repoDir, "rev-parse", "HEAD");

        Files.writeString(source.resolve("human.txt"), "human\n");
        runGit(source, "add", ".");
        runGit(source, "commit", "-m", "human push");
        runGit(source, "push", "origin", "HEAD:refs/heads/vibecode/fix");
        String humanSha = gitOutput(source, "rev-parse", "HEAD");

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(fixedSha, "vibecode/fix", reviewedSha));
        assertTrue(error.getMessage().contains("remote_head_moved"));
        assertEquals(humanSha,
            gitOutput(bare, "rev-parse", "refs/heads/vibecode/fix"));
    }

    @Test
    void cloneExistingBranchChecksOutTheReviewedCommit() throws Exception {
        FixRepo repo = initWithFixBranch("existing-branch");
        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "existing-branch", false, null);

        wm.cloneExistingBranch(repo.bare().toString(), "vibecode/fix", repo.reviewedSha());

        Path repoDir = wm.getRepoDir();
        assertEquals(repo.reviewedSha(), gitOutput(repoDir, "rev-parse", "HEAD"));
        assertEquals("vibecode/fix",
            gitOutput(repoDir, "rev-parse", "--abbrev-ref", "HEAD"));
        assertEquals("origin/vibecode/fix",
            gitOutput(repoDir, "rev-parse", "--abbrev-ref", "vibecode/fix@{upstream}"));
        assertEquals(repo.reviewedSha(), wm.getBaseCommit());
    }

    @Test
    void cloneExistingBranchReportsAMissingRemoteBranch() throws Exception {
        FixRepo repo = initWithFixBranch("existing-missing");
        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "existing-missing", false, null);

        IOException error = assertThrows(IOException.class, () -> wm.cloneExistingBranch(
            repo.bare().toString(), "vibecode/missing", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("reviewed_sha_mismatch"), error.getMessage());
    }

    @Test
    void cloneExistingBranchRejectsAMovedHead() throws Exception {
        FixRepo repo = initWithFixBranch("existing-moved");
        Files.writeString(repo.source().resolve("after.txt"), "later\n");
        runGit(repo.source(), "add", ".");
        runGit(repo.source(), "commit", "-m", "human push after review");
        runGit(repo.source(), "push", "origin", "HEAD:refs/heads/vibecode/fix");

        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "existing-moved", false, null);

        IOException error = assertThrows(IOException.class, () -> wm.cloneExistingBranch(
            repo.bare().toString(), "vibecode/fix", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("reviewed_sha_mismatch"));
    }

    @Test
    void cloneExistingBranchRejectsInvalidInputs() {
        WorkspaceManager wm = new WorkspaceManager(
            tempDir.toString(), "existing-invalid", false, null);
        String sha = "a".repeat(40);

        assertThrows(IOException.class, () -> wm.cloneExistingBranch(
            "https://example.test/r.git", "-evil", sha));
        assertThrows(IOException.class, () -> wm.cloneExistingBranch(
            "https://example.test/r.git", "feat/fix", "not-a-sha"));
    }

    private record FixRepo(Path source, Path bare, String reviewedSha) {
    }

    private FixRepo initWithFixBranch(String name) throws Exception {
        Path source = initRepo(name + "-source");
        Path bare = initBare(name + ".git");
        runGit(source, "remote", "add", "origin", bare.toString());
        runGit(source, "push", "origin", "HEAD:refs/heads/main");
        runGit(bare, "symbolic-ref", "HEAD", "refs/heads/main");
        runGit(source, "push", "origin", "HEAD:refs/heads/vibecode/fix");
        return new FixRepo(source, bare, gitOutput(source, "rev-parse", "HEAD"));
    }

    private WorkspaceManager cloneFixBranch(String name, FixRepo repo, GitHubTokenSource tokens)
        throws Exception {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), name, false, null, tokens);
        wm.cloneRepo(repo.bare().toString(), "vibecode/fix");
        return wm;
    }

    private String commitFix(WorkspaceManager wm) throws Exception {
        Path repoDir = wm.getRepoDir();
        runGit(repoDir, "config", "user.email", "fix@example.com");
        runGit(repoDir, "config", "user.name", "Fixer");
        Files.writeString(repoDir.resolve("fix.txt"), "fixed\n");
        runGit(repoDir, "add", ".");
        runGit(repoDir, "commit", "-m", "fix review findings");
        return gitOutput(repoDir, "rev-parse", "HEAD");
    }

    /**
     * Wrapper git that delegates to the real binary, exposing {@code $cmd} (the
     * subcommand after the supervisor's {@code -c} options) so a test can
     * intercept fetch/push and inspect {@code GIT_ASKPASS}.
     */
    private Path wrapperGit(String name, String body) throws Exception {
        assumePosix();
        Path bin = Files.createDirectories(tempDir.resolve(name));
        Path git = bin.resolve("git");
        String realGit = new String(new ProcessBuilder("sh", "-c", "command -v git")
            .start().getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
        String script = "#!/bin/sh\n"
            + "REAL_GIT='" + realGit + "'\n"
            + "cmd=\"\"\n"
            + "skip=\"\"\n"
            + "for a in \"$@\"; do\n"
            + "  if [ -n \"$skip\" ]; then skip=\"\"; continue; fi\n"
            + "  case \"$a\" in\n"
            + "    -c) skip=1; continue ;;\n"
            + "    -*) continue ;;\n"
            + "    *) cmd=\"$a\"; break ;;\n"
            + "  esac\n"
            + "done\n"
            + body
            + "exec \"$REAL_GIT\" \"$@\"\n";
        Files.writeString(git, script);
        Files.setPosixFilePermissions(git,
            java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
        return git;
    }

    @Test
    void publishFastForwardAuthenticatesItsFetches() throws Exception {
        FixRepo repo = initWithFixBranch("ff-auth");
        Path log = tempDir.resolve("ff-auth-askpass.log");
        Path git = wrapperGit("ff-auth-bin",
            "case \"$cmd\" in\n"
            + "  fetch|push)\n"
            + "    printf '%s ASKPASS=%s\\n' \"$cmd\" \"$GIT_ASKPASS\" >> '" + log + "'\n"
            + "    case \"$GIT_ASKPASS\" in\n"
            + "      ''|/dev/null|NUL)\n"
            + "        echo 'fatal: could not read Username for https://git.example: "
            + "terminal prompts disabled' >&2\n"
            + "        exit 1 ;;\n"
            + "    esac ;;\n"
            + "esac\n");

        WorkspaceManager wm = cloneFixBranch("ff-auth", repo, tokenSource("ghs_fetch_token"));
        setField(wm, "gitBinary", git.toString());
        String fixedSha = commitFix(wm);

        assertEquals(fixedSha,
            wm.publishFastForward(fixedSha, "vibecode/fix", repo.reviewedSha()));
        assertEquals(fixedSha,
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"));

        List<String> lines = Files.readAllLines(log);
        assertEquals(List.of("fetch", "push", "fetch"),
            lines.stream().map(line -> line.split(" ")[0]).toList(), lines.toString());
        assertTrue(lines.stream().noneMatch(line -> line.endsWith("ASKPASS=/dev/null")),
            "a fetch or push ran without the askpass helper: " + lines);
    }

    @Test
    void publishFastForwardRefreshesTheCredentialWhenTheFetchIsRejected() throws Exception {
        FixRepo repo = initWithFixBranch("ff-auth-refresh");
        Path failedOnce = tempDir.resolve("ff-auth-refresh-failed-once");
        Path captured = tempDir.resolve("ff-auth-refresh-askpass.sh");
        Path git = wrapperGit("ff-auth-refresh-bin",
            "case \"$cmd\" in\n"
            + "  fetch)\n"
            + "    if [ ! -f '" + failedOnce + "' ]; then\n"
            + "      touch '" + failedOnce + "'\n"
            + "      echo 'fatal: Authentication failed for repo' >&2\n"
            + "      exit 1\n"
            + "    fi ;;\n"
            + "  push)\n"
            + "    cp \"$GIT_ASKPASS\" '" + captured + "' ;;\n"
            + "esac\n");

        final int[] refreshes = {0};
        GitHubTokenSource tokens = new GitHubTokenSource() {
            @Override
            public String get() {
                return "ghs_first";
            }

            @Override
            public String refresh() {
                refreshes[0] += 1;
                return "ghs_refreshed";
            }
        };
        WorkspaceManager wm = cloneFixBranch("ff-auth-refresh", repo, tokens);
        setField(wm, "gitBinary", git.toString());
        String fixedSha = commitFix(wm);

        assertEquals(fixedSha,
            wm.publishFastForward(fixedSha, "vibecode/fix", repo.reviewedSha()));
        assertEquals(1, refreshes[0]);
        assertTrue(Files.readString(captured).contains("ghs_refreshed"));
        assertEquals(fixedSha,
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"));
    }

    @Test
    void publishFastForwardReportsPossiblyPublishedWhenTheVerificationFetchFails()
        throws Exception {
        FixRepo repo = initWithFixBranch("ff-verify");
        Path fetchCount = tempDir.resolve("ff-verify-fetch-count");
        Path git = wrapperGit("ff-verify-bin",
            "case \"$cmd\" in\n"
            + "  fetch)\n"
            + "    count=0\n"
            + "    [ -f '" + fetchCount + "' ] && count=$(cat '" + fetchCount + "')\n"
            + "    count=$((count + 1))\n"
            + "    echo \"$count\" > '" + fetchCount + "'\n"
            + "    if [ \"$count\" -eq 2 ]; then\n"
            + "      echo 'fatal: unable to access repo: Could not resolve host' >&2\n"
            + "      exit 1\n"
            + "    fi ;;\n"
            + "esac\n");

        WorkspaceManager wm = cloneFixBranch("ff-verify", repo, tokenSource("ghs_token"));
        setField(wm, "gitBinary", git.toString());
        String fixedSha = commitFix(wm);

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(fixedSha, "vibecode/fix", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("possibly_published"), error.getMessage());
        assertEquals(fixedSha,
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"),
            "the push happened before the verification failure");
    }

    @Test
    void publishFastForwardReportsPossiblyPublishedWhenTheFailedPushCannotBeReRead()
        throws Exception {
        FixRepo repo = initWithFixBranch("ff-push-unreadable");
        Path fetchCount = tempDir.resolve("ff-push-unreadable-fetch-count");
        Path git = wrapperGit("ff-push-unreadable-bin",
            "case \"$cmd\" in\n"
            + "  fetch)\n"
            + "    count=0\n"
            + "    [ -f '" + fetchCount + "' ] && count=$(cat '" + fetchCount + "')\n"
            + "    count=$((count + 1))\n"
            + "    echo \"$count\" > '" + fetchCount + "'\n"
            + "    if [ \"$count\" -eq 2 ]; then\n"
            + "      echo 'fatal: unable to access repo: Could not resolve host' >&2\n"
            + "      exit 1\n"
            + "    fi ;;\n"
            + "  push)\n"
            + "    echo 'fatal: the remote end hung up unexpectedly' >&2\n"
            + "    exit 1 ;;\n"
            + "esac\n");

        WorkspaceManager wm = cloneFixBranch("ff-push-unreadable", repo, tokenSource("ghs_token"));
        setField(wm, "gitBinary", git.toString());
        String fixedSha = commitFix(wm);

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(fixedSha, "vibecode/fix", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("possibly_published"), error.getMessage());
        assertEquals(repo.reviewedSha(),
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"));
    }

    @Test
    void publishFastForwardRefreshesAndRetriesWhenTheHeadReReadFailsAuthentication()
        throws Exception {
        FixRepo repo = initWithFixBranch("ff-reread-auth");
        Path fetchCount = tempDir.resolve("ff-reread-auth-fetch-count");
        Path pushCount = tempDir.resolve("ff-reread-auth-push-count");
        Path git = wrapperGit("ff-reread-auth-bin",
            "case \"$cmd\" in\n"
            + "  fetch)\n"
            + "    count=0\n"
            + "    [ -f '" + fetchCount + "' ] && count=$(cat '" + fetchCount + "')\n"
            + "    count=$((count + 1))\n"
            + "    echo \"$count\" > '" + fetchCount + "'\n"
            + "    if [ \"$count\" -eq 2 ]; then\n"
            + "      echo 'fatal: Authentication failed for repo' >&2\n"
            + "      exit 1\n"
            + "    fi ;;\n"
            + "  push)\n"
            + "    count=0\n"
            + "    [ -f '" + pushCount + "' ] && count=$(cat '" + pushCount + "')\n"
            + "    count=$((count + 1))\n"
            + "    echo \"$count\" > '" + pushCount + "'\n"
            + "    if [ \"$count\" -eq 1 ]; then\n"
            + "      echo 'fatal: the remote end hung up unexpectedly' >&2\n"
            + "      exit 1\n"
            + "    fi ;;\n"
            + "esac\n");

        final int[] refreshes = {0};
        GitHubTokenSource tokens = new GitHubTokenSource() {
            @Override
            public String get() {
                return "ghs_first";
            }

            @Override
            public String refresh() {
                refreshes[0] += 1;
                return "ghs_refreshed";
            }
        };
        WorkspaceManager wm = cloneFixBranch("ff-reread-auth", repo, tokens);
        setField(wm, "gitBinary", git.toString());
        String fixedSha = commitFix(wm);

        assertEquals(fixedSha,
            wm.publishFastForward(fixedSha, "vibecode/fix", repo.reviewedSha()));
        assertEquals(1, refreshes[0]);
        assertEquals(fixedSha,
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"));
    }

    @Test
    void publishFastForwardDistinguishesAncestryFailureFromAnUnknownReviewedSha()
        throws Exception {
        FixRepo repo = initWithFixBranch("ff-unknown-reviewed");
        WorkspaceManager wm = cloneFixBranch("ff-unknown-reviewed", repo, tokenSource("ghs_token"));
        String fixedSha = commitFix(wm);
        String unknown = "0123456789abcdef0123456789abcdef01234567";

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(fixedSha, "vibecode/fix", unknown));
        assertFalse(error.getMessage().contains("not_fast_forward"), error.getMessage());
        assertTrue(error.getMessage().contains("merge-base"), error.getMessage());
    }

    @Test
    void publishFastForwardReportsRemoteHeadMismatchAfterPublishing() throws Exception {
        FixRepo repo = initWithFixBranch("ff-mismatch");
        Path fetchCount = tempDir.resolve("ff-mismatch-fetch-count");
        Path git = wrapperGit("ff-mismatch-bin",
            "case \"$cmd\" in\n"
            + "  fetch)\n"
            + "    count=0\n"
            + "    [ -f '" + fetchCount + "' ] && count=$(cat '" + fetchCount + "')\n"
            + "    count=$((count + 1))\n"
            + "    echo \"$count\" > '" + fetchCount + "'\n"
            + "    if [ \"$count\" -eq 2 ]; then exit 0; fi ;;\n"
            + "esac\n");

        WorkspaceManager wm = cloneFixBranch("ff-mismatch", repo, tokenSource("ghs_token"));
        setField(wm, "gitBinary", git.toString());
        String fixedSha = commitFix(wm);

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(fixedSha, "vibecode/fix", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("remote_head_mismatch"), error.getMessage());
        assertTrue(error.getMessage().contains("possibly_published"), error.getMessage());
    }

    @Test
    void publishFastForwardRejectsACommitThatDoesNotDescendFromTheReviewedSha() throws Exception {
        FixRepo repo = initWithFixBranch("ff-root");
        WorkspaceManager wm = cloneFixBranch("ff-root", repo, tokenSource("ghs_token"));
        Path repoDir = wm.getRepoDir();
        runGit(repoDir, "config", "user.email", "fix@example.com");
        runGit(repoDir, "config", "user.name", "Fixer");
        String tree = gitOutput(repoDir, "rev-parse", "HEAD^{tree}");
        String rootCommit = gitOutput(repoDir, "commit-tree", tree, "-m", "unrelated root");

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(rootCommit, "vibecode/fix", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("not_fast_forward"), error.getMessage());
        assertEquals(repo.reviewedSha(),
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"));
    }

    @Test
    void publishFastForwardRejectsRewrittenHistoryEvenWhenTheRemoteMatches() throws Exception {
        FixRepo repo = initWithFixBranch("ff-rewritten");
        WorkspaceManager wm = cloneFixBranch("ff-rewritten", repo, tokenSource("ghs_token"));
        Path repoDir = wm.getRepoDir();
        runGit(repoDir, "config", "user.email", "fix@example.com");
        runGit(repoDir, "config", "user.name", "Fixer");
        runGit(repoDir, "checkout", "--orphan", "unrelated");
        runGit(repoDir, "commit", "--allow-empty", "-m", "unrelated root");
        String rootCommit = gitOutput(repoDir, "rev-parse", "HEAD");
        // A human force-pushes an unrelated history to the same branch.
        runGit(repoDir, "push", "--force", "origin",
            rootCommit + ":refs/heads/vibecode/fix");

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(rootCommit, "vibecode/fix", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("not_fast_forward"), error.getMessage());
    }

    @Test
    void publishFastForwardReportsRemoteHeadMovedWhenAPushRacesTheFetch() throws Exception {
        FixRepo repo = initWithFixBranch("ff-race");
        WorkspaceManager wm = cloneFixBranch("ff-race", repo, tokenSource("ghs_token"));
        String fixedSha = commitFix(wm);

        // Prepare a human commit but push it only from inside the supervisor's
        // push invocation, i.e. after the pre-push fetch.
        Files.writeString(repo.source().resolve("human.txt"), "human\n");
        runGit(repo.source(), "add", ".");
        runGit(repo.source(), "commit", "-m", "human push");
        String humanSha = gitOutput(repo.source(), "rev-parse", "HEAD");

        Path raced = tempDir.resolve("ff-race-pushed");
        Path git = wrapperGit("ff-race-bin",
            "if [ \"$cmd\" = \"push\" ] && [ ! -f '" + raced + "' ]; then\n"
            + "  touch '" + raced + "'\n"
            + "  \"$REAL_GIT\" -C '" + repo.source()
            + "' push origin HEAD:refs/heads/vibecode/fix >/dev/null 2>&1\n"
            + "fi\n");
        setField(wm, "gitBinary", git.toString());

        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward(fixedSha, "vibecode/fix", repo.reviewedSha()));
        assertTrue(error.getMessage().contains("remote_head_moved"), error.getMessage());
        assertEquals(humanSha,
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"));
    }

    @Test
    void publishFastForwardDryRunReturnsTheResolvedCommitId() throws Exception {
        FixRepo repo = initWithFixBranch("ff-dry");
        WorkspaceManager wm = cloneFixBranch("ff-dry", repo, tokenSource("ghs_token"));
        String fixedSha = commitFix(wm);

        WorkspaceManager dry = new WorkspaceManager(tempDir.toString(), "ff-dry-run", true, null);
        setRepoDir(dry, wm.getRepoDir());

        assertEquals(fixedSha,
            dry.publishFastForward(fixedSha.substring(0, 12), "vibecode/fix",
                repo.reviewedSha()));
        assertEquals(repo.reviewedSha(),
            gitOutput(repo.bare(), "rev-parse", "refs/heads/vibecode/fix"),
            "a dry run must not publish");
    }

    @Test
    void publishFastForwardFailsClosedWithoutAClone() {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "ff-no-clone", false, null);
        IOException error = assertThrows(IOException.class,
            () -> wm.publishFastForward("a".repeat(40), "ok", "b".repeat(40)));
        assertTrue(error.getMessage().contains("no workspace"), error.getMessage());
    }

    @Test
    void publishFastForwardRejectsInvalidInputs() {
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "ff-invalid", false, null);
        String sha = "a".repeat(40);
        assertThrows(IOException.class, () -> wm.publishFastForward(sha, "-evil", sha));
        assertThrows(IOException.class, () -> wm.publishFastForward(sha, "bad..branch", sha));
        assertThrows(IOException.class, () -> wm.publishFastForward(sha, "bad branch", sha));
        assertThrows(IOException.class, () -> wm.publishFastForward(sha, "ok", "not-a-sha"));
        assertThrows(IOException.class, () -> wm.publishFastForward(null, "ok", sha));
    }

    private static GitHubTokenSource tokenSource(String token) {
        return new GitHubTokenSource() {
            @Override
            public String get() {
                return token;
            }

            @Override
            public String refresh() {
                return token;
            }
        };
    }
}
