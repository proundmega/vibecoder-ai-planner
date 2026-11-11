package com.vibecode.agent.harness;

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
import java.nio.file.Path;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Set;

/**
 * Race-free file access for the workspace bridge.
 *
 * <p>{@code toRealPath()} followed by {@code Files.writeString(...,
 * NOFOLLOW_LINKS)} still follows a parent-directory symlink if the workspace
 * process swaps that directory between the check and the open. This helper
 * walks the relative path through {@link SecureDirectoryStream} descriptors,
 * opening every component with {@code NOFOLLOW_LINKS} and opening the final
 * file relative to the held parent descriptor.</p>
 */
final class WorkspaceSecureFile {

    private WorkspaceSecureFile() {
    }

    @FunctionalInterface
    private interface SecureAction<T> {
        T apply(SecureDirectoryStream<Path> parent, Path name) throws IOException;
    }

    static SeekableByteChannel openRead(Path workspaceReal, Path target) throws IOException {
        return withFile(workspaceReal, target, (parent, name) -> {
            requireRegularFile(parent, name);
            return parent.newByteChannel(name, Set.of(StandardOpenOption.READ));
        });
    }

    static SeekableByteChannel openReadWrite(Path workspaceReal, Path target) throws IOException {
        return withFile(workspaceReal, target, (parent, name) -> {
            requireRegularFile(parent, name);
            return parent.newByteChannel(name,
                Set.of(StandardOpenOption.READ, StandardOpenOption.WRITE));
        });
    }

    static void writeString(Path workspaceReal, Path target, String content, boolean create)
        throws IOException {
        withFile(workspaceReal, target, (parent, name) -> {
            if (create) {
                allowCreate(parent, name);
            } else {
                requireRegularFile(parent, name);
            }
            Set<StandardOpenOption> options = create
                ? Set.of(StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE)
                : Set.of(StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE);
            try (SeekableByteChannel channel = parent.newByteChannel(name, options)) {
                writeFully(channel, content.getBytes(StandardCharsets.UTF_8));
            }
            return null;
        });
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

    private static <T> T withFile(Path workspaceReal, Path target, SecureAction<T> action)
        throws IOException {
        Path relative = workspaceReal.relativize(target);
        if (relative.getNameCount() == 0 || relative.startsWith("..")) {
            throw new IOException("path escapes the workspace");
        }
        try (DirectoryStream<Path> rootStream = Files.newDirectoryStream(workspaceReal)) {
            if (!(rootStream instanceof SecureDirectoryStream<Path> root)) {
                throw new IOException("secure directory stream is unavailable");
            }
            return descend(root, relative, 0, action);
        }
    }

    private static <T> T descend(
        SecureDirectoryStream<Path> directory,
        Path relative,
        int index,
        SecureAction<T> action
    ) throws IOException {
        Path name = relative.getName(index);
        if (index == relative.getNameCount() - 1) {
            return action.apply(directory, name);
        }
        try (SecureDirectoryStream<Path> child = directory.newDirectoryStream(
            name, LinkOption.NOFOLLOW_LINKS)) {
            return descend(child, relative, index + 1, action);
        }
    }
}
