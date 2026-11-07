package com.vibecode.agent.harness;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class SandboxImageSecurityScriptTest {

    private static final Path SCRIPT = Path.of("scripts", "sandbox-image-security.sh")
        .toAbsolutePath();
    private static final String DIGEST =
        "@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8";

    @TempDir
    Path tempDir;

    @BeforeEach
    void requireBash() {
        assumeTrue(bashAvailable(), "bash is not available on this platform");
    }

    @Test
    void repositoryDockerfilesAreDigestPinned() throws Exception {
        Result result = run("--check-pins");

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("digest-pinned"), result.output);
    }

    @Test
    void rejectsAnUnpinnedDockerfile() throws Exception {
        Path dockerfile = dockerfile("Unpinned.Dockerfile", "FROM node:24-alpine\n");

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void rejectsLowercaseFrom() throws Exception {
        Path dockerfile = dockerfile("Lower.Dockerfile", "from node:24-alpine\n");

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void rejectsMixedCaseFrom() throws Exception {
        Path dockerfile = dockerfile("Mixed.Dockerfile", "From node:24-alpine\n");

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void rejectsUtf8BomBeforeAnUnpinnedFrom() throws Exception {
        Path dockerfile = tempDir.resolve("Bom.Dockerfile");
        Files.write(dockerfile, "\uFEFFFROM node:24-alpine\n".getBytes(StandardCharsets.UTF_8));

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void rejectsADigestThatOnlyAppearsInAnInlineComment() throws Exception {
        Path dockerfile = dockerfile("Comment.Dockerfile",
            "FROM node:24-alpine # " + DIGEST + "\n");

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void rejectsAnUnpinnedImageBehindAPlatformFlag() throws Exception {
        Path dockerfile = dockerfile("Platform.Dockerfile",
            "from --platform=linux/amd64 node:24-alpine\n");

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void allowsScratchAndDigestPinnedImages() throws Exception {
        Path dockerfile = dockerfile("Pinned.Dockerfile", """
            FROM scratch
            FROM node:24-alpine%s
            FROM node:24-alpine%s AS build
            """.formatted(DIGEST, DIGEST));

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(0, result.exitCode, result.output);
    }

    @Test
    void allowsAReferenceToAnEarlierBuildStage() throws Exception {
        Path dockerfile = dockerfile("Stages.Dockerfile", """
            FROM scratch AS base
            FROM base AS runtime
            FROM node:24-alpine%s AS node
            FROM node AS final
            """.formatted(DIGEST));

        Result result = run("--check-pins", "--dockerfile", dockerfile.toString());

        assertEquals(0, result.exitCode, result.output);
    }

    @Test
    void allRunsThePinCheckBeforeTheSbomStep() throws Exception {
        Path script = copyScriptInto(tempDir.resolve("fake-agent"));
        Files.writeString(tempDir.resolve("fake-agent/sandbox.Dockerfile"),
            "from node:24-alpine\n");
        Files.writeString(tempDir.resolve("fake-agent/sandbox-proxy.Dockerfile"), "FROM scratch\n");
        Files.writeString(tempDir.resolve("fake-agent/Dockerfile"), "FROM scratch\n");

        Result result = runScript(script, Map.of(), null, "--all", "fake:image");

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("unpinned base image"), result.output);
    }

    @Test
    void allGeneratesAnSbomAndScansWhenTheToolsArePresent() throws Exception {
        Path tools = stubTools();

        Result result = runScript(SCRIPT, Map.of(), tools,
            "--all", "fake:image", tempDir.resolve("sbom.spdx.json").toString());

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("SBOM written"), result.output);
        assertTrue(result.output.contains("trivy scan passed"), result.output);
    }

    @Test
    void scanFailsWhenAToolIsRequiredButMissing() throws Exception {
        Path emptyPath = pathWithoutScanners();

        Result result = runScript(SCRIPT, Map.of("SANDBOX_SCAN_REQUIRED", "1"), emptyPath,
            "--scan", "fake:image");

        assertEquals(2, result.exitCode, result.output);
        assertTrue(result.output.contains("no image scanner installed"), result.output);
    }

    @Test
    void scanWarnsAndSkipsWhenNoToolIsInstalled() throws Exception {
        Path emptyPath = pathWithoutScanners();

        Result result = runScript(SCRIPT, Map.of(), emptyPath, "--scan", "fake:image");

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("SBOM/scan gate skipped"), result.output);
    }

    private Path dockerfile(String name, String content) throws IOException {
        Path dockerfile = tempDir.resolve(name);
        Files.writeString(dockerfile, content);
        return dockerfile;
    }

    private Path copyScriptInto(Path root) throws IOException {
        Path scripts = Files.createDirectories(root.resolve("scripts"));
        Path script = scripts.resolve("sandbox-image-security.sh");
        Files.copy(SCRIPT, script);
        return script;
    }

    private Path stubTools() throws IOException {
        Path tools = Files.createDirectories(tempDir.resolve("tools"));
        writeStub(tools, "syft", "echo '{}'\n");
        writeStub(tools, "trivy", "exit 0\n");
        writeStub(tools, "grype", "exit 0\n");
        return tools;
    }

    /**
     * A PATH containing the helper the script needs at startup but none of the
     * optional scanners, so the tool-missing branches are deterministic even
     * when the developer machine has trivy/grype installed.
     */
    private Path pathWithoutScanners() throws Exception {
        Path bin = Files.createDirectory(tempDir.resolve("no-scanners"));
        Process lookup = new ProcessBuilder("bash", "-c", "command -v dirname")
            .redirectErrorStream(true)
            .start();
        String dirname = new String(lookup.getInputStream().readAllBytes(),
            StandardCharsets.UTF_8).trim();
        assumeTrue(lookup.waitFor() == 0 && !dirname.isEmpty(), "dirname is not available");
        Files.createSymbolicLink(bin.resolve("dirname"), Path.of(dirname));
        return bin;
    }

    private void writeStub(Path dir, String name, String body) throws IOException {
        Path stub = dir.resolve(name);
        Files.writeString(stub, "#!/usr/bin/env bash\n" + body);
        Files.setPosixFilePermissions(stub, PosixFilePermissions.fromString("rwxr-xr-x"));
    }

    private Result run(String... args) throws IOException, InterruptedException {
        return runScript(SCRIPT, Map.of(), null, args);
    }

    private Result runScript(Path script, Map<String, String> extraEnv, Path path,
            String... args) throws IOException, InterruptedException {
        List<String> command = new java.util.ArrayList<>();
        command.add("bash");
        command.add(script.toString());
        command.addAll(List.of(args));
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.remove("SANDBOX_SCAN_REQUIRED");
        env.remove("COSIGN_PUBLIC_KEY");
        env.putAll(extraEnv);
        if (path != null) {
            env.put("PATH", path + ":" + env.getOrDefault("PATH", ""));
        }
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return new Result(process.waitFor(), output);
    }

    private static boolean bashAvailable() {
        try {
            Process process = new ProcessBuilder("bash", "-c", "exit 0")
                .redirectErrorStream(true)
                .start();
            return process.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private record Result(int exitCode, String output) {
    }
}
