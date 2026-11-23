package com.vibecode.agent.supervisor;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** fg-58: disk/inode sample for the storage watermarks. */
public record StorageUsage(double diskPct, double inodePct) {

    public static StorageUsage sample(Path root) {
        double disk = dfPercent(root, false);
        double inodes = dfPercent(root, true);
        return new StorageUsage(disk, inodes);
    }

    private static double dfPercent(Path root, boolean inodes) {
        try {
            ProcessBuilder builder = new ProcessBuilder(
                "df", inodes ? "-Pi" : "-Pk", root.toString());
            builder.redirectErrorStream(true);
            Process process = builder.start();
            String output = new String(process.getInputStream().readAllBytes());
            int exit = process.waitFor();
            if (exit != 0) {
                return 0;
            }
            String[] lines = output.strip().split("\\R");
            if (lines.length < 2) {
                return 0;
            }
            String[] cols = lines[1].trim().split("\\s+");
            if (cols.length < 5) {
                return 0;
            }
            String value = cols[4].replace("%", "").trim();
            return Double.parseDouble(value);
        } catch (IOException | InterruptedException | NumberFormatException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return 0;
        }
    }
}
