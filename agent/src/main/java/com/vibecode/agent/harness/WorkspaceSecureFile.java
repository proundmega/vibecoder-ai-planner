package com.vibecode.agent.harness;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * File access for the workspace bridge.
 *
 * <p>Where {@link SecureDirectoryStream} is available this is race-free: it
 * walks the relative path through held directory descriptors, opens every
 * component with {@code NOFOLLOW_LINKS} and opens the final file relative to
 * the held parent with {@code NOFOLLOW_LINKS} as well.</p>
 *
 * <p>Providers without {@link SecureDirectoryStream} (native Windows) use a
 * best-effort canonical-path fallback. Sandbox mode fails fast instead of
 * using that fallback. Host mode is explicitly not a security boundary.</p>
 */
final class WorkspaceSecureFile {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceSecureFile.class);
    private static final AtomicBoolean FALLBACK_WARNED = new AtomicBoolean();
    private static volatile boolean forceFallbackForTesting = false;
    private static volatile TestHook beforeFinalOpen = () -> { };

    private WorkspaceSecureFile() {
    }

    @FunctionalInterface
    interface TestHook {
        void run() throws IOException;
    }

    static void forceFallbackForTesting(boolean value) {
        forceFallbackForTesting = value;
    }

    static void setBeforeFinalOpenForTesting(TestHook hook) {
        beforeFinalOpen = hook == null ? () -> { } : hook;
    }

    static boolean secureDirectoryStreamsAvailable(Path workspaceReal) {
        if (forceFallbackForTesting) {
            return false;
        }
        try (DirectoryStream<Path> rootStream = Files.newDirectoryStream(workspaceReal)) {
            return rootStream instanceof SecureDirectoryStream<Path>;
        } catch (IOException e) {
            return false;
        }
    }

    static SeekableByteChannel openRead(Path workspaceReal, Path target) throws IOException {
        return open(workspaceReal, target, false, false,
            Set.of(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS));
    }

    static SeekableByteChannel openReadWrite(Path workspaceReal, Path target) throws IOException {
        return open(workspaceReal, target, true, false,
            Set.of(StandardOpenOption.READ, StandardOpenOption.WRITE,
                LinkOption.NOFOLLOW_LINKS));
    }

    static void writeString(Path workspaceReal, Path target, String content, boolean create)
        throws IOException {
        Set<OpenOption> options = create
            ? Set.of(StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)
            : Set.of(StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE,
                LinkOption.NOFOLLOW_LINKS);
        try (SeekableByteChannel channel =
                 open(workspaceReal, target, true, create, options)) {
            writeFully(channel, content.getBytes(StandardCharsets.UTF_8));
        }
    }

    static BufferedReader newBufferedReader(Path workspaceReal, Path target) throws IOException {
        SeekableByteChannel channel = openRead(workspaceReal, target);
        return new BufferedReader(Channels.newReader(channel, StandardCharsets.UTF_8));
    }

    static byte[] readAll(Path workspaceReal, Path target, long maxBytes) throws IOException {
        try (SeekableByteChannel channel = openRead(workspaceReal, target)) {
            long size = channel.size();
            if (size > maxBytes) {
                throw new IOException("file is too large");
            }
            ByteBuffer buffer = ByteBuffer.allocate((int) size);
            while (buffer.hasRemaining()) {
                int read = channel.read(buffer);
                if (read < 0) {
                    break;
                }
            }
            return buffer.array();
        }
    }

    static String readString(Path workspaceReal, Path target, long maxBytes) throws IOException {
        byte[] bytes = readAll(workspaceReal, target, maxBytes);
        return decodeUtf8(bytes);
    }

    static String decodeUtf8(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString();
    }

    static void writeFully(SeekableByteChannel channel, byte[] bytes) throws IOException {
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        while (buffer.hasRemaining()) {
            channel.write(buffer);
        }
    }

    private static SeekableByteChannel open(
        Path workspaceReal,
        Path target,
        boolean writable,
        boolean create,
        Set<OpenOption> options
    ) throws IOException {
        Path relative = safeRelative(workspaceReal, target);
        if (!forceFallbackForTesting) {
            try (DirectoryStream<Path> rootStream = Files.newDirectoryStream(workspaceReal)) {
                if (rootStream instanceof SecureDirectoryStream<Path> root) {
                    return openSecure(root, relative, options, create);
                }
            }
        }
        if (FALLBACK_WARNED.compareAndSet(false, true)) {
            log.warn("SecureDirectoryStream is unavailable; using the non-atomic host-mode "
                + "file fallback (host mode is not a security boundary)");
        }
        return openFallback(workspaceReal, target, writable, create, options);
    }

    private static SeekableByteChannel openSecure(
        SecureDirectoryStream<Path> root,
        Path relative,
        Set<OpenOption> options,
        boolean create
    ) throws IOException {
        return descend(root, relative, 0, options, create);
    }

    private static SeekableByteChannel descend(
        SecureDirectoryStream<Path> directory,
        Path relative,
        int index,
        Set<OpenOption> options,
        boolean create
    ) throws IOException {
        Path name = relative.getName(index);
        if (index == relative.getNameCount() - 1) {
            if (create) {
                allowCreate(directory, name);
            } else {
                requireRegularFile(directory, name);
            }
            beforeFinalOpen.run();
            // LinkOption.NOFOLLOW_LINKS is in `options`, so a final-component
            // swap to a symlink is rejected at open time.
            return directory.newByteChannel(name, options);
        }
        try (SecureDirectoryStream<Path> child = directory.newDirectoryStream(
            name, LinkOption.NOFOLLOW_LINKS)) {
            return descend(child, relative, index + 1, options, create);
        }
    }

    private static SeekableByteChannel openFallback(
        Path workspaceReal,
        Path target,
        boolean writable,
        boolean create,
        Set<OpenOption> options
    ) throws IOException {
        Path resolved = writable
            ? WorkspacePathPolicy.resolveWritable(workspaceReal, target.toString())
            : WorkspacePathPolicy.resolveReadable(workspaceReal, target.toString());
        if (writable) {
            if (Files.exists(resolved, LinkOption.NOFOLLOW_LINKS)) {
                BasicFileAttributes attrs = Files.readAttributes(
                    resolved, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                if (attrs.isSymbolicLink() || !attrs.isRegularFile()) {
                    throw new IOException("refusing to write a non-regular file");
                }
            } else if (!create) {
                throw new IOException("not a regular file");
            }
        } else if (!Files.isRegularFile(resolved, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("not a regular file");
        }
        return Files.newByteChannel(resolved, options);
    }

    private static Path safeRelative(Path workspaceReal, Path target) throws IOException {
        for (Path segment : target) {
            if ("..".equals(segment.toString())) {
                throw new IOException("path escapes the workspace");
            }
        }
        Path normalized = target.isAbsolute()
            ? target.normalize()
            : workspaceReal.resolve(target).normalize();
        if (!normalized.startsWith(workspaceReal)) {
            throw new IOException("path escapes the workspace");
        }
        Path relative = workspaceReal.relativize(normalized);
        if (relative.getNameCount() == 0) {
            throw new IOException("a file path is required");
        }
        return relative;
    }

    private static void allowCreate(SecureDirectoryStream<Path> parent, Path name)
        throws IOException {
        try {
            BasicFileAttributes attrs = attributes(parent, name);
            if (attrs.isSymbolicLink() || !attrs.isRegularFile()) {
                throw new IOException("refusing to write a non-regular file");
            }
        } catch (java.nio.file.NoSuchFileException e) {
            // New file is allowed; the create below stays relative to the
            // secured parent descriptor.
        }
    }

    private static void requireRegularFile(SecureDirectoryStream<Path> parent, Path name)
        throws IOException {
        BasicFileAttributes attrs = attributes(parent, name);
        if (attrs.isSymbolicLink() || !attrs.isRegularFile()) {
            throw new IOException("not a regular file");
        }
    }

    private static BasicFileAttributes attributes(SecureDirectoryStream<Path> parent, Path name)
        throws IOException {
        BasicFileAttributeView view = parent.getFileAttributeView(
            name, BasicFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
        if (view == null) {
            throw new IOException("could not inspect path");
        }
        return view.readAttributes();
    }
}
