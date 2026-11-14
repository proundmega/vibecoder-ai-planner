"use strict";

// Minimal allowlist HTTP/CONNECT proxy for fg-34 sandboxes.
//
// The proxy is the only container attached to both the sandbox's internal
// network and an upstream network. The sandbox has no default route, so every
// outbound request must pass through here. Every denied request is logged as a
// single JSON line so the supervisor can surface it.
//
// Test seams:
//   node egress-proxy.js --check-allow host:port
//     Performs the generic allowlist/blocked-name/IP/port checks (plain HTTP).
//   node egress-proxy.js --check-connect host:port
//     Applies CONNECT policy (443 only) plus the generic checks.
//   node egress-proxy.js --check-resolve host
//     Runs the DNS/private-address check (with the gated test resolver seam).
//   node egress-proxy.js --check-hello <base64>
//     Parses a TLS ClientHello and reports the SNI/error.

const crypto = require("crypto");
const dns = require("dns");
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const stream = require("stream");
const tls = require("tls");
const { spawnSync } = require("child_process");

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
const TLS_MODE = String(process.env.EGRESS_TLS_MODE || "sni-only").trim().toLowerCase();
if (TLS_MODE !== "sni-only" && TLS_MODE !== "terminate") {
  console.error(
    "ERROR EGRESS_TLS_MODE must be one of: sni-only, terminate (got: " + TLS_MODE + ")"
  );
  process.exit(1);
}
const CA_DIR = process.env.EGRESS_CA_DIR || "/tmp/vibecode-egress-ca";
const MAX_TUNNELS = 32;
const MAX_LEAF_CERTS = 256;
const MAX_RESPONSE_HEADER_BYTES = 32 * 1024;
const TEST_MODE = process.env.EGRESS_TEST_MODE === "1";
const TEST_CONNECT_PORT = TEST_MODE
  ? Number(process.env.EGRESS_TEST_CONNECT_PORT || "0")
  : 0;
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

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


function failStartup(message) {
  log("error", "egress proxy startup failed", { reason: message });
  process.exit(1);
}

function runOpenssl(args, timeoutMs) {
  const result = spawnSync("openssl", args, {
    encoding: "utf8",
    timeout: timeoutMs || 10_000,
  });
  if (result.error || result.status !== 0) {
    const detail = String(
      result.error && result.error.message ? result.error.message : result.stderr || ""
    ).trim();
    throw new Error("openssl " + args[0] + " failed" + (detail ? ": " + detail : ""));
  }
  return result;
}

let caCertPath = null;
let caKeyPath = null;
const leafCache = new Map();

function initTerminateMode() {
  if (TLS_MODE !== "terminate") {
    return;
  }
  if (typeof crypto.constants.SSL_OP_NO_RENEGOTIATION !== "number") {
    throw new Error("the Node/OpenSSL runtime does not expose SSL_OP_NO_RENEGOTIATION");
  }
  runOpenssl(["version"], 5_000);
  fs.mkdirSync(CA_DIR, { recursive: true, mode: 0o700 });
  caCertPath = path.join(CA_DIR, "ca.crt");
  caKeyPath = path.join(CA_DIR, "ca.key");
  runOpenssl([
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
    "-nodes", "-keyout", caKeyPath, "-out", caCertPath, "-days", "1",
    "-subj", "/CN=vibecode-egress-" + process.pid,
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    "-addext", "subjectKeyIdentifier=hash",
  ]);
  fs.chmodSync(caKeyPath, 0o600);
  fs.chmodSync(caCertPath, 0o644);
}

function leafFor(sni) {
  const cached = leafCache.get(sni);
  if (cached) {
    leafCache.delete(sni);
    leafCache.set(sni, cached);
    return cached;
  }
  if (!/^[a-z0-9.-]+$/i.test(sni) || sni.length > 253) {
    throw new Error("invalid SNI for a leaf certificate");
  }
  if (leafCache.size >= MAX_LEAF_CERTS) {
    const oldest = leafCache.keys().next().value;
    leafCache.delete(oldest);
  }
  const dir = fs.mkdtempSync(path.join(CA_DIR, "leaf-"));
  const keyFile = path.join(dir, "leaf.key");
  const csrFile = path.join(dir, "leaf.csr");
  const certFile = path.join(dir, "leaf.crt");
  const extFile = path.join(dir, "leaf.ext");
  try {
    fs.writeFileSync(extFile, [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=DNS:" + sni,
      "subjectKeyIdentifier=hash",
      "authorityKeyIdentifier=keyid,issuer",
      "",
    ].join("\n"));
    runOpenssl([
      "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
      "-nodes", "-keyout", keyFile, "-out", csrFile, "-subj", "/CN=" + sni,
      "-addext", "subjectAltName=DNS:" + sni,
    ]);
    runOpenssl([
      "x509", "-req", "-in", csrFile, "-CA", caCertPath, "-CAkey", caKeyPath,
      "-CAcreateserial", "-days", "1", "-extfile", extFile, "-out", certFile,
    ]);
    fs.chmodSync(keyFile, 0o600);
    fs.chmodSync(certFile, 0o644);
    const context = tls.createSecureContext({
      cert: fs.readFileSync(certFile, "utf8"),
      key: fs.readFileSync(keyFile, "utf8"),
      minVersion: "TLSv1.2",
    });
    const entry = {
      context,
      createdAt: Date.now(),
      certPem: fs.readFileSync(certFile, "utf8"),
    };
    leafCache.set(sni, entry);
    return entry;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A Duplex that replays the already-consumed ClientHello and then proxies bytes. */
class ReplayDuplex extends stream.Duplex {
  constructor(prefix, socket) {
    super();
    this.prefix = Buffer.from(prefix);
    this.socket = socket;
    socket.pause();
    socket.on("data", (chunk) => {
      if (!this.push(chunk)) {
        socket.pause();
      }
    });
    socket.on("end", () => this.push(null));
    socket.on("error", (error) => this.destroy(error));
    socket.on("close", () => this.destroy());
  }

  _read() {
    if (this.prefix && this.prefix.length > 0) {
      const prefix = this.prefix;
      this.prefix = null;
      this.push(prefix);
    }
    this.socket.resume();
  }

  _write(chunk, encoding, callback) {
    this.socket.write(chunk, encoding, callback);
  }

  _final(callback) {
    this.socket.end(callback);
  }

  _destroy(error, callback) {
    this.socket.destroy();
    callback(error);
  }
}

function rawHeaderValues(message, name) {
  const wanted = name.toLowerCase();
  const values = [];
  for (let i = 0; i + 1 < message.rawHeaders.length; i += 2) {
    if (message.rawHeaders[i].toLowerCase() === wanted) {
      values.push(message.rawHeaders[i + 1]);
    }
  }
  return values;
}

function normaliseAuthority(value) {
  let host = String(value || "").trim().toLowerCase();
  if (!host || /[\s/@\\]/.test(host)) {
    return null;
  }
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  if (host.endsWith(":443")) {
    host = host.slice(0, -4);
  }
  if (!host || host.includes(":")) {
    return null;
  }
  return host;
}

function framingError(message) {
  const contentLengths = rawHeaderValues(message, "content-length");
  const transferEncodings = rawHeaderValues(message, "transfer-encoding");
  if (contentLengths.length > 0 && transferEncodings.length > 0) {
    return "both Content-Length and Transfer-Encoding";
  }
  if (contentLengths.length > 1) {
    return "duplicate Content-Length";
  }
  if (contentLengths.length === 1) {
    const value = contentLengths[0].trim();
    if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 15) {
      return "non-canonical Content-Length";
    }
  }
  if (transferEncodings.length > 1) {
    return "duplicate Transfer-Encoding";
  }
  if (transferEncodings.length === 1
      && transferEncodings[0].trim().toLowerCase() !== "chunked") {
    return "unsupported Transfer-Encoding";
  }
  return null;
}

function connectionHasUpgrade(message) {
  return rawHeaderValues(message, "connection")
    .join(",")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .includes("upgrade");
}

function denyTunneled(response, reason, host) {
  logDenied({ host, port: 443, reason });
  if (!response.headersSent) {
    response.writeHead(403, { "content-length": "0", connection: "close" });
  }
  response.end();
}

function sanitizedHeaders(message, host, contentLength) {
  const headers = {};
  for (let i = 0; i + 1 < message.rawHeaders.length; i += 2) {
    const name = message.rawHeaders[i].toLowerCase();
    const value = message.rawHeaders[i + 1];
    if (HOP_BY_HOP.has(name) || name === "host" || name === "content-length"
        || name === "transfer-encoding") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      headers[name] = [].concat(headers[name], value);
    } else {
      headers[name] = value;
    }
  }
  headers.host = host;
  if (contentLength !== null) {
    headers["content-length"] = contentLength;
  }
  return headers;
}

function handleTunneledRequest(request, response, host, address, port, agent, tlsSocket) {
  if (tlsSocket._egressBusy) {
    denyTunneled(response, "concurrent request on the tunnel", host);
    return;
  }
  tlsSocket._egressBusy = true;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      tlsSocket._egressBusy = false;
    }
  };
  response.on("finish", release);
  response.on("close", release);

  if (request.method === "CONNECT") {
    denyTunneled(response, "nested CONNECT is not supported", host);
    return;
  }
  if (request.url === "*" || !request.url.startsWith("/")) {
    denyTunneled(response, "request target is not origin-form", host);
    return;
  }
  const hosts = rawHeaderValues(request, "host");
  if (hosts.length !== 1) {
    denyTunneled(response, hosts.length === 0 ? "missing Host" : "duplicate Host", host);
    return;
  }
  const authority = normaliseAuthority(hosts[0]);
  if (!authority || authority !== normaliseHost(host)) {
    denyTunneled(response, "Host does not match the CONNECT target", host);
    return;
  }
  const expects = rawHeaderValues(request, "expect");
  if (expects.length > 1
      || (expects.length === 1 && expects[0].trim().toLowerCase() !== "100-continue")) {
    denyTunneled(response, "unsupported Expect", host);
    return;
  }
  if (rawHeaderValues(request, "upgrade").length > 0 || connectionHasUpgrade(request)) {
    denyTunneled(response, "Upgrade is not supported", host);
    return;
  }
  const framing = framingError(request);
  if (framing) {
    denyTunneled(response, framing, host);
    return;
  }
  const contentLengths = rawHeaderValues(request, "content-length");
  const contentLength = contentLengths.length === 1 ? contentLengths[0].trim() : null;

  const upstreamRequest = https.request({
    host: address,
    port,
    method: request.method,
    path: request.url,
    headers: sanitizedHeaders(request, host, contentLength),
    servername: host,
    agent,
    minVersion: "TLSv1.2",
    secureOptions: crypto.constants.SSL_OP_NO_RENEGOTIATION,
    maxHeaderSize: MAX_RESPONSE_HEADER_BYTES,
    timeout: IDLE_TIMEOUT_MS,
  }, (upstreamResponse) => {
    const status = upstreamResponse.statusCode || 502;
    if (status === 101 || (status >= 100 && status < 200)) {
      upstreamResponse.destroy();
      denyTunneled(response, "unexpected informational response", host);
      return;
    }
    if (rawHeaderValues(upstreamResponse, "upgrade").length > 0
        || connectionHasUpgrade(upstreamResponse)) {
      upstreamResponse.destroy();
      denyTunneled(response, "origin protocol switch is not supported", host);
      return;
    }
    const responseFraming = framingError(upstreamResponse);
    if (responseFraming) {
      upstreamResponse.destroy();
      denyTunneled(response, "invalid response framing: " + responseFraming, host);
      return;
    }
    const headers = {};
    for (let i = 0; i + 1 < upstreamResponse.rawHeaders.length; i += 2) {
      const name = upstreamResponse.rawHeaders[i].toLowerCase();
      if (!HOP_BY_HOP.has(name)) {
        headers[name] = upstreamResponse.rawHeaders[i + 1];
      }
    }
    response.writeHead(status, headers);
    if (request.method === "HEAD" || status === 204 || status === 304) {
      let bodySeen = false;
      upstreamResponse.on("data", (chunk) => {
        if (chunk.length > 0) {
          bodySeen = true;
          upstreamResponse.destroy();
          response.destroy();
        }
      });
      upstreamResponse.on("end", () => {
        if (!bodySeen && !response.writableEnded) {
          response.end();
        }
      });
    } else {
      upstreamResponse.pipe(response);
    }
  });
  upstreamRequest.on("continue", () => {
    if (!response.headersSent) {
      response.writeContinue();
    }
  });
  upstreamRequest.on("information", (info) => {
    if (info.statusCode === 103) {
      response.writeEarlyHints(info.headers);
    } else if (info.statusCode !== 100) {
      upstreamRequest.destroy(new Error("unexpected informational response"));
      denyTunneled(response, "unexpected informational response", host);
    }
  });
  upstreamRequest.on("upgrade", (upstreamResponse, socket) => {
    socket.destroy();
    denyTunneled(response, "origin protocol switch is not supported", host);
  });
  upstreamRequest.on("timeout", () => upstreamRequest.destroy(new Error("timeout")));
  upstreamRequest.on("error", (error) => {
    logDenied({ host, port: 443, reason: "origin request failed: " + error.message });
    if (!response.headersSent) {
      response.writeHead(502, { "content-length": "0" });
    }
    response.end();
  });
  response.on("close", () => {
    if (!upstreamRequest.destroyed) {
      upstreamRequest.destroy();
    }
  });
  request.pipe(upstreamRequest);
}

function readTunnelHello(clientSocket, host, initial, onValidated) {
  let buffer = initial && initial.length > 0 ? Buffer.from(initial) : Buffer.alloc(0);
  let settled = false;
  let timer = null;

  const finish = (allowed, reason) => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer) {
      clearTimeout(timer);
    }
    clientSocket.removeListener("data", onData);
    clientSocket.removeListener("error", onError);
    clientSocket.removeListener("close", onClose);
    if (!allowed) {
      logDenied({ method: "CONNECT", host, port: 443, reason });
      clientSocket.destroy();
      return;
    }
    clientSocket.pause();
    onValidated(buffer);
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
  const onError = () => finish(false, "client error");
  const onClose = () => finish(false, "client closed");

  timer = setTimeout(
    () => finish(false, "tunnel validation timeout"),
    TUNNEL_PROBE_TIMEOUT_MS
  );
  clientSocket.on("data", onData);
  clientSocket.on("error", onError);
  clientSocket.on("close", onClose);
  if (buffer.length > 0) {
    inspect();
  }
}

function startTerminateTunnel(clientSocket, host, address, port, initial) {
  readTunnelHello(clientSocket, host, initial, (prefix) => {
    let leaf;
    try {
      leaf = leafFor(host);
    } catch (error) {
      logDenied({
        method: "CONNECT",
        host,
        port,
        reason: "could not mint the TLS certificate: " + error.message,
      });
      clientSocket.destroy();
      return;
    }
    const replay = new ReplayDuplex(prefix, clientSocket);
    const tlsSocket = new tls.TLSSocket(replay, {
      isServer: true,
      secureContext: leaf.context,
      ALPNProtocols: ["http/1.1"],
      minVersion: "TLSv1.2",
      secureOptions: crypto.constants.SSL_OP_NO_RENEGOTIATION,
    });
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
    let server = null;
    tlsSocket.on("error", (error) => {
      logDenied({
        method: "CONNECT",
        host,
        port,
        reason: "TLS termination failed: " + error.message,
      });
      replay.destroy();
    });
    tlsSocket.on("secure", () => {
      if (tlsSocket.alpnProtocol && tlsSocket.alpnProtocol !== "http/1.1") {
        logDenied({
          method: "CONNECT",
          host,
          port,
          reason: "ALPN did not negotiate HTTP/1.1",
        });
        tlsSocket.destroy();
        return;
      }
      server = http.createServer((request, response) => {
        handleTunneledRequest(request, response, host, address, port, agent, tlsSocket);
      });
      server.maxHeadersCount = 100;
      server.headersTimeout = 10_000;
      server.requestTimeout = 30_000;
      server.on("upgrade", (request, socket) => {
        logDenied({
          method: "CONNECT",
          host,
          port,
          reason: "client requested a protocol switch",
        });
        socket.destroy();
      });
      server.on("clientError", (error, socket) => {
        try {
          socket.destroy();
        } catch (ignored) {
          // Ignore.
        }
      });
      server.emit("connection", tlsSocket);
    });
    tlsSocket.on("close", () => {
      if (server) {
        try {
          server.close();
        } catch (ignored) {
          // The per-tunnel HTTP server may not have been listening.
        }
      }
      agent.destroy();
    });
    replay.on("error", () => replay.destroy());
  });
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
  if (!ALLOWED_PORTS.has(port) && !(TEST_CONNECT_PORT === port && port > 0)) {
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
    const statusText = status === 403
      ? "Forbidden"
      : status === 503
        ? "Service Unavailable"
        : "Bad Request";
    socket.write(
      `HTTP/1.1 ${status} ${statusText}\r\n` +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n\r\n"
    );
  } catch (ignored) {
    // The peer may already have gone away.
  }
  socket.destroy();
}

function resolveSafe(host, callback) {
  // Deterministic test seam for the Java resolveSafe regression tests. It is
  // only honored when EGRESS_TEST_MODE=1, which the supervisor explicitly
  // clears in the proxy container's environment.
  const testMode = TEST_MODE;
  const override = testMode ? process.env.EGRESS_TEST_RESOLVE_IP : null;
  if (override) {
    if (isPrivateAddress(override)) {
      if (testMode && process.env.EGRESS_TEST_ALLOW_LOOPBACK === "1"
          && override === "127.0.0.1") {
        callback(null, override);
        return;
      }
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

let activeTunnels = 0;

function acquireTunnel(clientSocket) {
  if (activeTunnels >= MAX_TUNNELS) {
    return false;
  }
  activeTunnels++;
  let released = false;
  clientSocket.once("close", () => {
    if (!released) {
      released = true;
      activeTunnels--;
    }
  });
  return true;
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
  if (authority.port !== 443 && !(TEST_CONNECT_PORT === authority.port && authority.port > 0)) {
    denyRaw(clientSocket, 403, "CONNECT is only supported on 443",
      authority.host, authority.port);
    return;
  }
  const reason = staticDenyReason(authority.host, authority.port);
  if (reason) {
    denyRaw(clientSocket, 403, reason, authority.host, authority.port);
    return;
  }
  if (!acquireTunnel(clientSocket)) {
    denyRaw(clientSocket, 503, "too many concurrent tunnels",
      authority.host, authority.port);
    return;
  }

  resolveSafe(authority.host, (error, address) => {
    if (error) {
      denyRaw(clientSocket, 403, error.message, authority.host, authority.port);
      return;
    }
    if (TLS_MODE === "terminate") {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      startTerminateTunnel(clientSocket, authority.host, address, authority.port, head);
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

  if (TLS_MODE === "terminate") {
    try {
      initTerminateMode();
    } catch (error) {
      failStartup(error.message);
    }
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
      tlsMode: TLS_MODE,
      caCert: TLS_MODE === "terminate" ? caCertPath : undefined,
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
} else if (process.argv.includes("--check-leaf")) {
  try {
    if (TLS_MODE !== "terminate") {
      throw new Error("EGRESS_TLS_MODE must be terminate");
    }
    initTerminateMode();
    const sni = process.argv[process.argv.indexOf("--check-leaf") + 1];
    const entry = leafFor(String(sni || ""));
    console.log(entry.certPem);
    process.exit(0);
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exit(1);
  }
} else if (process.argv.includes("--check-tls-init")) {
  try {
    if (TLS_MODE !== "terminate") {
      throw new Error("EGRESS_TLS_MODE must be terminate");
    }
    initTerminateMode();
    console.log(`CA ${caCertPath}`);
    process.exit(0);
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.exit(1);
  }
} else if (process.argv.includes("--check-connect")) {
  const target = process.argv[process.argv.indexOf("--check-connect") + 1];
  const authority = parseAuthority(target);
  if (!authority) {
    console.log("DENY bad authority");
    process.exit(1);
  }
  if (authority.port !== 443) {
    console.log("DENY CONNECT is only supported on 443");
    process.exit(1);
  }
  const reason = staticDenyReason(authority.host, authority.port);
  if (reason) {
    console.log(`DENY ${reason}`);
    process.exit(1);
  }
  console.log("ALLOW");
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
