"use strict";

// Minimal HTTPS origin used by EgressProxyTerminateIntegrationTest. It logs
// every parsed request so the test can prove a chunked body did not smuggle a
// second request past the proxy.

const fs = require("fs");
const https = require("https");

const [port, certFile, keyFile, logFile] = process.argv.slice(2);
const log = (line) => fs.appendFileSync(logFile, line + "\n");

const server = https.createServer({
  cert: fs.readFileSync(certFile),
  key: fs.readFileSync(keyFile),
}, (request, response) => {
  log(`${request.method} ${request.url} ${request.headers.host || ""}`);
  if (request.url === "/204") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === "/304") {
    response.writeHead(304);
    response.end();
    return;
  }
  if (request.url === "/101") {
    response.writeHead(101, { Connection: "Upgrade", Upgrade: "websocket" });
    response.end();
    return;
  }
  if (request.url === "/hop") {
    response.writeHead(200, {
      "Set-Cookie": ["a=1", "b=2"],
      "Proxy-Authenticate": "Basic",
      "X-Origin": "ok",
      Connection: "keep-alive",
      "Keep-Alive": "timeout=5",
    });
    response.end("hop");
    return;
  }
  if (request.url === "/big") {
    response.writeHead(200, { "X-Big": "x".repeat(40_000) });
    response.end("big");
    return;
  }
  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("ok");
});

server.listen(Number(port), "127.0.0.1", () => {
  console.log("origin listening");
});
