package com.vibecode.agent.service;

import com.vibecode.agent.model.FileOperation;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class WorkspaceManagerTest {

    @TempDir
    Path tempDir;

    private Path setRepoDir(WorkspaceManager wm, Path repoDir) throws Exception {
        Field repoDirField = wm.getClass().getDeclaredField("repoDir");
        repoDirField.setAccessible(true);
        repoDirField.set(wm, repoDir);
        return repoDir;
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
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "my-repo_name!@#", false, null);
        Path expectedRepoDir = tempDir.resolve("my-repo_name___");
        Field repoDirField = wm.getClass().getDeclaredField("repoDir");
        repoDirField.setAccessible(true);
        Path actualRepoDir = (Path) repoDirField.get(wm);
        assertEquals(expectedRepoDir, actualRepoDir);
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
        WorkspaceManager wm = new WorkspaceManager(tempDir.toString(), "test-repo", false, null);
        Path repoDir = tempDir.resolve("test-repo");
        Files.createDirectories(repoDir);
        Files.createDirectories(repoDir.resolve(".git"));
        setRepoDir(wm, repoDir);
        
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
}
