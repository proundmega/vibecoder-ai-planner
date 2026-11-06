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
  log("warn", "egress denied", { decision: "deny", host, port, reason });
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
  dns.lookup(host, { all: true }, (error, addresses) => {
    if (error || !Array.isArray(addresses) || addresses.length === 0) {
      callback(new Error("dns lookup failed"));
      return;
    }
    const safe = addresses.find((entry) => !isPrivateAddress(entry.address));
    if (!safe) {
      callback(new Error("resolves to a private address"));
      return;
    }
    callback(null, safe.address);
  });
}

function handleConnect(request, clientSocket, head) {
  const authority = parseAuthority(request.url);
  if (!authority) {
    denyRaw(clientSocket, 400, "bad authority", "", 0);
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
        log("info", "egress allowed", {
          decision: "allow",
          method: "CONNECT",
          host: authority.host,
          port: authority.port,
        });
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length > 0) {
          upstream.write(head);
        }
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
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
    log("warn", "egress denied", {
      decision: "deny",
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
      log("warn", "egress denied", {
        decision: "deny",
        method: request.method,
        host,
        port,
        reason: error.message,
      });
      response.writeHead(403).end();
      return;
    }

    log("info", "egress allowed", {
      decision: "allow",
      method: request.method,
      host,
      port,
    });

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

if (process.argv.includes("--check-allow")) {
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
