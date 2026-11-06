package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SandboxImageSecurityScriptTest {

    private static final Path SCRIPT = Path.of("scripts", "sandbox-image-security.sh")
        .toAbsolutePath();

    @TempDir
    Path tempDir;

    @Test
    void repositoryDockerfilesAreDigestPinned() throws Exception {
        Result result = run("--check-pins");

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("digest-pinned"), result.output);
    }

    @Test
    void rejectsAnUnpinnedDockerfile() throws Exception {
        Path dockerfile = tempDir.resolve("Unpinned.Dockerfile");
        Files.writeString(dockerfile, "FROM node:24-alpine\n");

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void allowsScratchAndDigestPinnedImages() throws Exception {
        Path dockerfile = tempDir.resolve("Pinned.Dockerfile");
        Files.writeString(dockerfile, """
            FROM scratch
            FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
            FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
            """);

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(0, result.exitCode, result.output);
    }

    private Result run(String... args) throws IOException, InterruptedException {
        List<String> command = new java.util.ArrayList<>();
        command.add("bash");
        command.add(SCRIPT.toString());
        command.addAll(List.of(args));
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.remove("SANDBOX_SCAN_REQUIRED");
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return new Result(process.waitFor(), output);
    }

    private record Result(int exitCode, String output) {
    }
}
