"use strict";

// Minimal allowlist HTTP/CONNECT proxy for fg-34 sandboxes.
//
// The proxy is the only container attached to both the sandbox's internal
// network and an upstream network. The sandbox has no default route, so every
// outbound request must pass through here. Every denied request is logged as a
// single JSON line so the supervisor can surface it.
//
// Test seam: `node egress-proxy.js --check-allow host:port` performs the
// static checks (allowlist, blocked name, IP literal, port) and exits 0 when
// the target is allowed. It deliberately does not resolve DNS.

const dns = require("dns");
const http = require("http");
const net = require("net");

const PORT = Number(process.env.EGRESS_PORT || "3128");
const ALLOW = String(process.env.EGRESS_ALLOWED_HOSTS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 120_000;
const TUNNEL_PROBE_TIMEOUT_MS = Math.max(
  100,
  Number(process.env.EGRESS_TUNNEL_PROBE_TIMEOUT_MS || 5000) || 5000
);
const MAX_TUNNEL_PREFIX_BYTES = 64 * 1024;
const ALLOWED_PORTS = new Set([80, 443]);

function log(level, message, extra) {
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    ...extra,
  };
  console.log(JSON.stringify(record));
}

const MAX_DENY_LOGS_PER_SECOND = 20;
let denyWindowStarted = Date.now();
let denyWindowCount = 0;

// Denials are the only per-request log sink: allowed requests would let a
// hostile repo flood the supervisor's log storage. The rate limit bounds the
// denial stream too; the supervisor still sees the first N per second.
function logDenied(extra) {
  const now = Date.now();
  if (now - denyWindowStarted >= 1000) {
    denyWindowStarted = now;
    denyWindowCount = 0;
  }
  denyWindowCount++;
  if (denyWindowCount <= MAX_DENY_LOGS_PER_SECOND) {
    log("warn", "egress denied", { decision: "deny", ...extra });
  }
}

function normaliseHost(host) {
  return String(host || "").trim().toLowerCase().replace(/\.$/, "");
}

function isIpLiteral(host) {
  return net.isIP(host) !== 0;
}

function isBlockedName(host) {
  const value = normaliseHost(host);
  if (!value || value.length > 253) {
    return "invalid host";
  }
  if (value === "localhost" || value.endsWith(".localhost")) {
    return "localhost";
  }
  if (value === "metadata" || value === "metadata.google.internal") {
    return "metadata";
  }
  if (value.endsWith(".local") || value.endsWith(".internal") || value.endsWith(".home.arpa")) {
    return "internal name";
  }
  if (value === "host.docker.internal" || value === "gateway.docker.internal") {
    return "docker host";
  }
  if (/[\s/@\\]/.test(value)) {
    return "invalid host";
  }
  return null;
}

function matchesAllowlist(host) {
  const value = normaliseHost(host);
  for (const pattern of ALLOW) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      // `*.example.com` matches subdomains, not the apex.
      if (value.endsWith(suffix) && value.length > suffix.length) {
        return true;
      }
    } else if (value === pattern) {
      return true;
    }
  }
  return false;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 100 && b >= 64 && b <= 127) {
      return true;
    }
    // Cloud metadata / platform endpoints and non-routable test ranges.
    if (a === 168 && b === 63 && parts[2] === 129 && parts[3] === 16) {
      return true; // Azure WireServer
    }
    if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) {
      return true; // 192.0.0.0/24, 192.0.2.0/24
    }
    if (a === 198 && (b === 18 || b === 19)) {
      return true; // 198.18.0.0/15
    }
    if (a === 198 && b === 51 && parts[2] === 100) {
      return true; // 198.51.100.0/24
    }
    if (a === 203 && b === 0 && parts[2] === 113) {
      return true; // 203.0.113.0/24
    }
    return a >= 224;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") {
      return true;
    }
    if (value.startsWith("fc") || value.startsWith("fd")) {
      return true;
    }
    if (
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb")
    ) {
      return true;
    }
    if (value.startsWith("ff")) {
      return true;
    }
    if (value.startsWith("64:ff9b:")) {
      return true; // NAT64
    }
    if (value.startsWith("2002:")) {
      return true; // 6to4
    }
    if (value.startsWith("2001:db8:")) {
      return true; // documentation
    }
    if (value.startsWith("2001:0:")) {
      return true; // Teredo
    }
    if (value.startsWith("100::")) {
      return true; // discard-only
    }
    if (value.startsWith("::ffff:")) {
      return isPrivateAddress(value.slice(7));
    }
    return false;
  }
  return true;
}

function parseAuthority(value) {
  if (!value) {
    return null;
  }
  const index = value.lastIndexOf(":");
  if (index <= 0) {
    return null;
  }
  const host = value.slice(0, index).replace(/^\[|\]$/g, "").toLowerCase();
  const port = Number(value.slice(index + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  return { host, port };
}

function staticDenyReason(host, port) {
  const blocked = isBlockedName(host);
  if (blocked) {
    return blocked;
  }
  if (isIpLiteral(host)) {
    return "ip literal";
  }
  if (!ALLOWED_PORTS.has(port)) {
    return "port not allowed";
  }
  if (!matchesAllowlist(host)) {
    return "not in allowlist";
  }
  return null;
}

function denyRaw(socket, status, reason, host, port) {
  logDenied({ host, port, reason });
  try {
    socket.write(
      `HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Request"}\r\n` +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n\r\n"
    );
  } catch (ignored) {
    // The peer may already have gone away.
  }
  socket.destroy();
}

function resolveSafe(host, callback) {
  // Deterministic test seam for the Java resolveSafe regression tests. The
  // proxy container does not receive this variable from the sandbox.
  const override = process.env.EGRESS_TEST_RESOLVE_IP;
  if (override) {
    if (isPrivateAddress(override)) {
      callback(new Error("resolves to a private address"));
      return;
    }
    callback(null, override);
    return;
  }
  dns.lookup(host, { all: true }, (error, addresses) => {
    if (error || !Array.isArray(addresses) || addresses.length === 0) {
      callback(new Error("dns lookup failed"));
      return;
    }
    const safe = addresses.filter((entry) => !isPrivateAddress(entry.address));
    if (safe.length === 0) {
      callback(new Error("resolves to a private address"));
      return;
    }
    // Prefer IPv4 so a proxy without an IPv6 route still works; fall back to
    // IPv6 only when no safe IPv4 address exists.
    const chosen = safe.find((entry) => entry.family === 4) || safe[0];
    callback(null, chosen.address);
  });
}

/**
 * Parse the SNI from the first TLS ClientHello. Returns null while more bytes
 * are needed, {error} for a malformed/non-TLS prefix, or {sni, ech}.
 */
function parseClientHelloSni(buffer) {
  let offset = 0;
  let handshake = Buffer.alloc(0);
  while (offset + 5 <= buffer.length) {
    const contentType = buffer[offset];
    const length = buffer.readUInt16BE(offset + 3);
    if (contentType !== 0x16) {
      return { error: "not a TLS handshake" };
    }
    if (offset + 5 + length > buffer.length) {
      return null;
    }
    handshake = Buffer.concat([
      handshake,
      buffer.subarray(offset + 5, offset + 5 + length),
    ]);
    offset += 5 + length;
    if (handshake.length >= 4) {
      if (handshake[0] !== 0x01) {
        return { error: "not a ClientHello" };
      }
      const bodyLength = handshake.readUIntBE(1, 3);
      if (handshake.length < 4 + bodyLength) {
        return null;
      }
      if (handshake.length > 4 + bodyLength) {
        // A second handshake message (for example a second ClientHello) must
        // not be forwarded unchecked.
        return { error: "unexpected extra handshake data" };
      }
      const parsed = parseClientHelloBody(handshake.subarray(4, 4 + bodyLength));
      if (parsed.error) {
        return parsed;
      }
      // Reject any further handshake record in the same buffered prefix.
      // Application data (for example TLS 1.3 early data) is allowed.
      let scan = offset;
      while (scan + 5 <= buffer.length) {
        const type = buffer[scan];
        const recordLength = buffer.readUInt16BE(scan + 3);
        if (type === 0x16) {
          return { error: "multiple TLS handshakes" };
        }
        if (scan + 5 + recordLength > buffer.length) {
          break;
        }
        scan += 5 + recordLength;
      }
      return parsed;
    }
  }
  return null;
}

function parseClientHelloBody(body) {
  try {
    let index = 0;
    if (body.length < 2 + 32 + 1) {
      return { error: "truncated ClientHello" };
    }
    index += 2 + 32; // legacy_version + random
    const sessionLength = body[index];
    index += 1;
    if (index + sessionLength + 2 > body.length) {
      return { error: "truncated session id" };
    }
    index += sessionLength;
    const cipherLength = body.readUInt16BE(index);
    index += 2;
    if (index + cipherLength + 1 > body.length) {
      return { error: "truncated cipher suites" };
    }
    index += cipherLength;
    const compressionLength = body[index];
    index += 1;
    if (index + compressionLength + 2 > body.length) {
      return { error: "truncated compression methods" };
    }
    index += compressionLength;
    const extensionsLength = body.readUInt16BE(index);
    index += 2;
    const end = Math.min(body.length, index + extensionsLength);
    const names = [];
    let ech = false;
    while (index + 4 <= end) {
      const type = body.readUInt16BE(index);
      const length = body.readUInt16BE(index + 2);
      index += 4;
      if (index + length > end) {
        return { error: "truncated extension" };
      }
      if (type === 0x0000) {
        let cursor = index;
        if (cursor + 2 > index + length) {
          return { error: "truncated SNI list" };
        }
        const listLength = body.readUInt16BE(cursor);
        cursor += 2;
        const listEnd = Math.min(cursor + listLength, index + length);
        while (cursor + 3 <= listEnd) {
          const nameType = body[cursor];
          const nameLength = body.readUInt16BE(cursor + 1);
          cursor += 3;
          if (cursor + nameLength > listEnd) {
            return { error: "truncated SNI name" };
          }
          if (nameType === 0) {
            names.push(body.toString("ascii", cursor, cursor + nameLength));
          }
          cursor += nameLength;
        }
      } else if (type === 0xfe0d) {
        ech = true;
      }
      index += length;
    }
    if (names.length > 1) {
      return { error: "multiple SNI names" };
    }
    return { sni: names.length === 1 ? names[0] : null, ech };
  } catch (error) {
    return { error: "malformed ClientHello" };
  }
}

/** Parse the Host header of the first tunneled HTTP/1.x request. */
/**
 * Validate the first TLS ClientHello inside a CONNECT tunnel before forwarding
 * it. The SNI must equal the allowlisted CONNECT target; ECH, missing SNI,
 * multiple SNI names and extra handshakes are rejected. Only the validated
 * prefix is forwarded; later renegotiation is D16.
 */
function validateTunnel(clientSocket, upstream, host, initial) {
  let buffer = initial && initial.length > 0 ? Buffer.from(initial) : Buffer.alloc(0);
  let settled = false;

  const finish = (allowed, reason) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    clientSocket.removeListener("data", onData);
    if (!allowed) {
      logDenied({ method: "CONNECT", host, port: 443, reason });
      clientSocket.destroy();
      upstream.destroy();
      return;
    }
    if (buffer.length > 0) {
      upstream.write(buffer);
    }
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  };

  const inspect = () => {
    const parsed = parseClientHelloSni(buffer);
    if (parsed === null) {
      return;
    }
    if (parsed.error) {
      finish(false, parsed.error);
      return;
    }
    if (parsed.ech) {
      finish(false, "ECH is not supported");
      return;
    }
    if (!parsed.sni) {
      finish(false, "missing SNI");
      return;
    }
    if (normaliseHost(parsed.sni) !== normaliseHost(host)) {
      finish(false, "SNI does not match the CONNECT target");
      return;
    }
    finish(true);
  };

  const onData = (chunk) => {
    if (settled) {
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_TUNNEL_PREFIX_BYTES) {
      finish(false, "tunnel prefix too large");
      return;
    }
    inspect();
  };

  const timer = setTimeout(
    () => finish(false, "tunnel validation timeout"),
    TUNNEL_PROBE_TIMEOUT_MS
  );
  clientSocket.on("data", onData);
  clientSocket.on("error", () => finish(false, "client error"));
  clientSocket.on("close", () => finish(false, "client closed"));
  if (buffer.length > 0) {
    inspect();
  }
}

function handleConnect(request, clientSocket, head) {
  const authority = parseAuthority(request.url);
  if (!authority) {
    denyRaw(clientSocket, 400, "bad authority", "", 0);
    return;
  }
  // Plain HTTP uses absolute-form requests, which handleRequest() validates
  // per request. A CONNECT :80 tunnel would carry multiple HTTP messages that
  // cannot be checked after the first one, so it is not supported.
  if (authority.port !== 443) {
    denyRaw(clientSocket, 403, "CONNECT is only supported on 443",
      authority.host, authority.port);
    return;
  }
  const reason = staticDenyReason(authority.host, authority.port);
  if (reason) {
    denyRaw(clientSocket, 403, reason, authority.host, authority.port);
    return;
  }

  resolveSafe(authority.host, (error, address) => {
    if (error) {
      denyRaw(clientSocket, 403, error.message, authority.host, authority.port);
      return;
    }

    const upstream = net.connect(
      { host: address, port: authority.port, timeout: CONNECT_TIMEOUT_MS },
      () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        validateTunnel(clientSocket, upstream, authority.host, head);
      }
    );
    upstream.setTimeout(IDLE_TIMEOUT_MS, () => upstream.destroy());
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
}

function handleRequest(request, response) {
  let target;
  try {
    target = new URL(request.url);
  } catch (error) {
    response.writeHead(400).end();
    return;
  }
  if (target.protocol !== "http:") {
    response.writeHead(403).end();
    return;
  }

  const host = normaliseHost(target.hostname);
  const port = Number(target.port || 80);
  const reason = staticDenyReason(host, port);
  if (reason) {
    logDenied({
      method: request.method,
      host,
      port,
      reason,
    });
    response.writeHead(403).end();
    return;
  }

  resolveSafe(host, (error, address) => {
    if (error) {
      logDenied({
        method: request.method,
        host,
        port,
        reason: error.message,
      });
      response.writeHead(403).end();
      return;
    }

    const upstream = http.request(
      {
        host: address,
        port,
        method: request.method,
        path: target.pathname + target.search,
        headers: { ...request.headers, host: target.host },
        timeout: CONNECT_TIMEOUT_MS,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
    upstream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502).end();
      } else {
        response.destroy();
      }
    });
    request.pipe(upstream);
  });
}

function runProxy() {
  if (ALLOW.length === 0) {
    log("error", "egress proxy has no allowlist; refusing to start");
    process.exit(1);
  }

  const server = http.createServer(handleRequest);
  server.on("connect", handleConnect);
  server.on("clientError", (error, socket) => {
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } catch (ignored) {
      // Ignore.
    }
  });
  server.listen(PORT, "0.0.0.0", () => {
    log("info", "egress proxy listening", {
      port: PORT,
      allowlist: ALLOW,
    });
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (process.argv.includes("--check-hello")) {
  const encoded = process.argv[process.argv.indexOf("--check-hello") + 1];
  const parsed = parseClientHelloSni(Buffer.from(encoded, "base64"));
  if (parsed === null) {
    console.log("INCOMPLETE");
    process.exit(2);
  }
  if (parsed.error) {
    console.log(`ERROR ${parsed.error}`);
    process.exit(1);
  }
  console.log(`SNI ${parsed.sni || ""}${parsed.ech ? " ECH" : ""}`);
  process.exit(0);
} else if (process.argv.includes("--check-resolve")) {
  const target = process.argv[process.argv.indexOf("--check-resolve") + 1];
  const reason = staticDenyReason(normaliseHost(target), 443);
  if (reason) {
    console.log(`DENY ${reason}`);
    process.exit(1);
  }
  resolveSafe(target, (error, address) => {
    if (error) {
      console.log(`DENY ${error.message}`);
      process.exit(1);
    }
    console.log(`ALLOW ${address}`);
    process.exit(0);
  });
} else if (process.argv.includes("--check-allow")) {
  const target = process.argv[process.argv.indexOf("--check-allow") + 1];
  const authority = parseAuthority(target);
  if (!authority) {
    console.error("DENY bad authority");
    process.exit(1);
  }
  const reason = staticDenyReason(authority.host, authority.port);
  if (reason) {
    console.log(`DENY ${reason}`);
    process.exit(1);
  }
  console.log("ALLOW");
  process.exit(0);
} else {
  runProxy();
}
