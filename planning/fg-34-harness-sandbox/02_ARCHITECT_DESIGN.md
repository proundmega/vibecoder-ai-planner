# 02_ARCHITECT_DESIGN.md - Harness Sandbox and Supply-Chain Security (fg-34)

## Design summary

Introduce a `SandboxRunner` abstraction between the supervisor and the harness process. The supervisor never runs repo code directly; it asks the runner for a disposable sandbox, mounts the workspace, and receives artifacts on completion.

```
HarnessTicketProcessor (supervisor, outside sandbox)
  -> SandboxRunner.create(SandboxSpec)
       -> container: read-only rootfs, workspace mount, limits, no host socket
       -> network: egress proxy allowlist
       -> secrets: none; provider access via proxy/token broker
  -> OpenCodeClient runs in the supervisor
       -> tool/file calls over the control channel
       -> SandboxRunner.exec / putFile / getFile / stream
  -> artifacts: diff, test output, logs, exit status
  -> SandboxRunner.stop() / destroy()
```

## SandboxSpec

```java
record SandboxSpec(
    String image,
    Path workspace,
    Duration maxDuration,
    int cpus,
    long memoryBytes,
    int pids,
    long diskBytes,
    List<String> allowedHosts,
    Map<String, String> env,
    boolean networkEnabled
) {}
```

## SandboxRunner control channel

`SandboxRunner` is more than create/destroy. It exposes:

```java
SandboxHandle create(SandboxSpec spec);
ExecResult exec(SandboxHandle h, ExecRequest req);      // command, cwd, timeout, output cap
void stream(SandboxHandle h, ExecRequest req, Consumer<Chunk> sink);
void putFile(SandboxHandle h, Path local, String remote);
void getFile(SandboxHandle h, String remote, Path local);
void stop(SandboxHandle h);                             // kill process tree
void destroy(SandboxHandle h);
```

- OpenCode stays in the supervisor so it can call the model/provider proxy and receive events; it never runs repo code directly.
- The model's bash/read/write tools are replaced with guarded supervisor bridges (`sandbox_bash`, `sandbox_read`, `sandbox_grep`, `sandbox_write`, `sandbox_edit`). Prompts and event streaming stay on the supervisor side; the untrusted code runs in the sandbox.
- The channel is a per-run Unix socket (or a loopback port bound to 127.0.0.1) with a random per-run token. Repo processes cannot reach it and the sandbox exposes no inbound port. Slice 2 implements the token and loopback binding; request IDs and idempotent exec are **D17**.
- If a future OpenCode build must run inside the sandbox, add an explicit `attach/exec/port` contract and authenticated loopback channel; do not run it without one.

## Runtime

Start with Docker/Podman sibling containers, not Docker-in-Docker:

- `--read-only`, `--tmpfs /tmp`, workspace mounted writable;
- `--user 1000:1000`, `--cap-drop ALL`, `--security-opt no-new-privileges`;
- `--pids-limit`, `--memory`, `--cpus`, `--ulimit`, `--storage-opt size`;
- no `/var/run/docker.sock`, no host network, no privileged;
- seccomp/AppArmor profiles when the platform supports them;
- a hard `docker kill`/process-tree kill on timeout.

MicroVM (Firecracker/Kata) is a future option if containers are not a strong enough boundary.

## Network policy

Default deny. Allow only:

- the package registry hosts required by the repo profile (`npm`, PyPI, Maven Central, etc.);
- an internal artifact cache, if used.

Provider/model calls originate in the supervisor (OpenCode runs outside the sandbox), so no provider host needs to be reachable from repo code. Implement with an egress proxy or network namespace rules, log every denied request, and make the allowlist part of the repo profile rather than the prompt.

Slice 2 implements this with an internal Docker network whose only peer is a hardened allowlist proxy. The sandbox has no default route and external DNS is disabled. For CONNECT tunnels the proxy validates the TLS ClientHello SNI against the allowlisted target and rejects multiple SNI names, extra handshake messages, ECH and missing SNI. CONNECT :80 is rejected; plain HTTP uses per-request absolute-form validation. Only the first ClientHello is inspected: TLS renegotiation and the encrypted HTTP `Host` inside a TLS tunnel are not visible without TLS termination, so a shared-CDN tenant with the same allowlisted SNI remains a limitation (**D16**). The design that closes D16 is in [D16 CONNECT inspection](#d16-connect-inspection-design).

### D16 CONNECT inspection (design)

The SNI-only tunnel has two independent bypasses:

1. **Renegotiation.** After the validated first ClientHello, a TLS 1.2 peer can start another handshake inside the same tunnel. The proxy forwards those records without inspecting them.
2. **Inner authority.** The HTTP `Host`/`:authority` is encrypted. A client that reaches an allowlisted shared-CDN name can ask the CDN for a different tenant by changing `Host`, even though the certificate and SNI are for the allowlisted name.

Neither can be fixed by parsing more of the unmodified TLS stream. The chosen remedy is to terminate TLS at the proxy, validate each HTTP request against the CONNECT authority, and re-originate with a verified TLS connection. This also removes renegotiation as an attack surface: the client-proxy leg is owned by the proxy, and both TLS contexts set `SSL_OP_NO_RENEGOTIATION` (TLS 1.3 also forbids it), so a renegotiation attempt fails the connection.

#### Considered options

| Option | Renegotiation | Inner `Host` / shared CDN | Cost and residual |
|---|---|---|---|
| Keep SNI-only | Open | Open | Current behavior; D16 remains |
| TLS 1.3-only probe on the tunnel | Closed for 1.3-only origins | Open | Small, but does not close shared CDN and breaks 1.2-only registries |
| Require dedicated hosts by policy | Open | Operationally reduced | No code enforcement; cannot verify a host is dedicated |
| **TLS termination at the proxy** | **Closed** | **Closed by `Host == SNI`** | Large; trust-store injection and HTTP/1.1-only compatibility |

#### Data flow

1. The sandbox sends `CONNECT host:443` as today. The proxy performs the existing host/port/DNS/private-address checks and resolves the target once.
2. The proxy replies `200 Connection Established`, then reads and validates the first ClientHello exactly as today (single SNI, no ECH, no extra handshake, SNI equals the CONNECT host). The validated bytes are replayed into a server-side TLS socket; a replay duplex is used because the ClientHello was already consumed.
3. The proxy presents a leaf certificate for that SNI, signed by a per-run CA. ALPN advertises **only `http/1.1`**. A client that offers only `h2` fails closed; clients that offer both fall back to HTTP/1.1.
4. The proxy opens a fresh TLS connection to the resolved origin address with `servername` set to the SNI, normal certificate/hostname verification, and ALPN `http/1.1`. Origin certificate failure closes the tunnel.
5. The proxy parses each request with Node's strict HTTP/1.1 parser and **constructs a canonical request**; it never forwards the raw header block or raw bytes. The `Host` header must equal the CONNECT/SNI authority after normalisation: trim optional whitespace, lowercase, strip one trailing dot, accept and strip an explicit `:443`, and reject any other port, userinfo, or bracket form. Missing, duplicate, or different `Host` is rejected.
6. Framing is made unambiguous before forwarding. The proxy rejects:
   - any request with both `Transfer-Encoding` and `Content-Length`;
   - duplicate `Content-Length` headers, even with identical values, and comma-separated or otherwise non-canonical values;
   - a `Content-Length` that is not a plain non-negative decimal (including signs, whitespace, overflow, or leading `+`);
   - any `Transfer-Encoding` other than exactly one `chunked` token, multiple `Transfer-Encoding` headers, or unsupported transfer codings;
   - invalid chunked framing (bad chunk size, missing CRLF, premature EOF, or overflow);
   - absolute-form targets, `*`, nested `CONNECT`, `Upgrade`/WebSocket, `Connection: upgrade`, `Expect` values other than `100-continue`, and HTTP/1.0 without `Host`.

   The forwarded request has exactly one framing (a single `Content-Length` or chunked, never both), one `Host` set to the validated SNI, and no hop-by-hop headers. Bodies stream in both directions with the existing idle timeout and bounded header size/count.
7. Responses are parsed and re-serialized too, with the same framing discipline as requests. Ambiguous origin framing (`Transfer-Encoding` + `Content-Length`, duplicate `Content-Length`, unsupported transfer codings, malformed chunked framing) and oversized response headers are rejected and the tunnel closed. A `101 Switching Protocols`, any `Upgrade` header, or a `Connection: upgrade` token from the origin is rejected; the proxy never switches to raw piping. Other `1xx` responses are rejected except `100 Continue` and `103 Early Hints`; `Expect: 100-continue` is allowed and its interim response is relayed. Hop-by-hop headers are stripped, one canonical framing is forwarded to the client, and the body is streamed according to the parser.
8. Denials are logged as today (`host`, `reason`), never with `Authorization`, cookies, bodies, or URL query strings.

#### Per-run CA and trust injection

- The proxy generates an ECDSA P-256 CA at startup in its `/tmp` tmpfs (24-hour validity, random CN containing the proxy suffix). The CA certificate has `basicConstraints=critical,CA:TRUE`, `keyUsage=critical,keyCertSign,cRLSign`, and a subject key identifier; it is a proper trust anchor for strict clients. The CA private key never leaves the proxy container and is never passed through `docker inspect`; it is not part of the sandbox. Private-key files are mode `0600`; CA/leaf certificates are `0644`.
- Leaf certificates are minted on demand for the validated SNI and cached per host. They contain `subjectAltName=DNS:<sni>` only, `basicConstraints=critical,CA:FALSE`, `keyUsage=critical,digitalSignature`, `extendedKeyUsage=serverAuth`, and subject/authority key identifiers. They are signed by the per-run CA and never outlive it. The leaf cache is bounded (for example, 256 entries with LRU eviction) so a wildcard allowlist cannot generate unbounded certificates.
- The proxy image gains `openssl` and `ca-certificates` (the latter for origin verification). The base image stays digest-pinned, and the added packages are covered by the existing SBOM/vulnerability scan.
- At startup the proxy verifies that its Node/OpenSSL runtime exposes `SSL_OP_NO_RENEGOTIATION`; if it does not, the proxy refuses to start.
- Once the proxy reports ready, the supervisor copies the CA certificate out with `docker cp <proxy>:/tmp/vibecode-egress-ca/ca.crt <supervisor-temp-file>` and into the sandbox with `docker cp <supervisor-temp-file> <sandbox>:/tmp/vibecode-egress-ca.crt`. Both directions stream through the daemon, so they do not depend on a host-visible path or D8; the supervisor temp file is removed immediately. It verifies the copy is a readable PEM and makes it 0444. It then builds `/tmp/vibecode-ca-bundle.crt` from the **sandbox image's** `/etc/ssl/certs/ca-certificates.crt` (the image that runs repo commands, not the proxy image), read through a bounded `docker exec <sandbox> cat ...`, plus the per-run CA, and only then returns the sandbox handle. A CA copy failure fails sandbox creation closed. A missing system bundle is the only fallback: log a warning and use the CA-only file. Any other bundle read, concatenate, copy, or write failure (permissions, truncated output, or an unexpected error) also fails sandbox creation closed.
- The sandbox receives the paths through the toolchain-specific variables:
  `NODE_EXTRA_CA_CERTS`, `npm_config_cafile`, `SSL_CERT_FILE`, `GIT_SSL_CAINFO`, `CURL_CA_BUNDLE`, `PIP_CERT`, `REQUESTS_CA_BUNDLE`, `CARGO_HTTP_CAINFO`.
  `NODE_EXTRA_CA_CERTS` appends to Node's bundled roots. The OpenSSL-style variables point at the combined system-roots + per-run-CA bundle, so loopback/same-container TLS that uses a public root still works. The combined bundle does not make the proxy optional: all non-loopback egress still has no route except through the proxy. A repo's own self-signed loopback certificate is not trusted by this bundle; a local test must trust its own test CA or disable verification in that test. The copy is root-owned and world-readable; even if the sandbox user replaces it in writable `/tmp`, it can only affect that sandbox.
- The CA certificate and any cached leaves are removed with the proxy container. Nothing is written to the workspace or to the supervisor's HOME.

#### Compatibility and rollout

- This is intentionally HTTP/1.1-only. HTTP/2-only origins are unsupported in terminate mode; clients that support both fall back. Implementations that pin a certificate, use mTLS, or require a protocol switch fail closed and are documented as unsupported.
- Common sandbox toolchains (`npm`/Node, `pip`/Python, `git`, `curl`, Go, Cargo) honour at least one of the injected variables. Tools that ship and pin their own bundle, or ignore the variables, fail closed rather than silently bypassing the proxy.
- **Java/Maven/Gradle are unsupported in terminate mode for now.** The sandbox base image has no JDK; if a repo installs one, Java uses `$JAVA_HOME/lib/security/cacerts`, ignores the variables above, and fails closed. The future approach (issue #149 / D28) is to copy `cacerts`, import the per-run CA with `keytool`, and set `JAVA_TOOL_OPTIONS` when a JDK is present; without a JDK/keytool the failure stays explicit.
- `SANDBOX_EGRESS_TLS_MODE` selects `terminate` or `sni-only`; values are parsed strictly and an invalid value fails startup. `terminate` is **opt-in for now**; the default stays `sni-only` until the optional "enforce successful integration cycle before merge" control is decided/available (issue #146) and the terminate integration suite has passed. `sni-only` is explicit and loudly logged, and leaves D16 open.
- The new variable is forwarded by the root Compose API environment, the agent Compose file, `agent/.env.example`, and `PoolManager`, following the D22 pattern. Proxy image rebuilding and scanning are part of the same slice.
- Rollout: (1) implement termination behind the flag and keep `sni-only` as the default; (2) run the real-Docker integration suite with `terminate`, including npm/pip/git/curl; (3) decide/implement the optional integration-cycle merge control (#146), then flip the default for allowlist mode and update `00`, `01`, `03`, and `AGENTS.md`; (4) keep `sni-only` only as a documented escape hatch, never as a silent fallback, and decide its long-term retention (#147). D16 closes only after step 3 is verified, not when the code first lands.

#### Failure modes

| Failure | Behaviour |
|---|---|
| `openssl`/CA generation fails, the runtime lacks `SSL_OP_NO_RENEGOTIATION`, or the proxy cannot start | Sandbox creation fails; no direct-egress fallback |
| CA retrieval or copy into the sandbox fails | Sandbox creation fails closed |
| System trust bundle is missing | Sandbox creation proceeds with the CA-only file and logs a warning; public-root loopback TLS may fail |
| Combined bundle creation fails for any other reason | Sandbox creation fails closed; no partially trusted sandbox |
| Client does not trust the injected CA | TLS handshake fails; the command fails and the denial is logged |
| Origin certificate invalid, expired, or hostname mismatch | Tunnel closed; denial logged |
| `Host` missing, duplicated, absolute-form, or different from SNI | Request denied and tunnel closed |
| CL+TE, duplicate/ambiguous `Content-Length`, unsupported/multiple `Transfer-Encoding`, or malformed chunked framing | Request denied and tunnel closed; no raw forwarding |
| Origin returns ambiguous framing, oversized headers, `101`, `Upgrade`, `Connection: upgrade`, or an unexpected `1xx` | Response rejected and tunnel closed; no raw piping |
| Client offers only `h2` or a non-HTTP protocol | ALPN/handshake or HTTP parse fails closed |
| Client or origin attempts renegotiation or mTLS | Connection fails closed |
| Header or connection flood | Bounded headers plus an explicit cap of 32 concurrent CONNECT tunnels and one active request per tunnel; excess gets `503`/close and a denial log |
| Leaf cache reaches its bound | LRU eviction keeps the cache at 256 entries; no unbounded growth |
| Proxy crashes or is removed | Sandbox loses all egress; it does not fall back to an unfiltered route |

#### Security considerations

- Request smuggling cannot reopen the Host bypass because the proxy never forwards raw headers: it rejects ambiguous framing and re-serializes exactly one canonical request with one `Host` and one framing. A second request on the same shared-CDN connection is parsed and checked separately.
- Protocol switches cannot bypass the check: `101`, `Upgrade`, and `Connection: upgrade` are rejected on both sides, and the proxy never enters a raw pipe after the handshake.
- The per-run CA key is scoped to the proxy container and the run; it cannot sign anything outside that sandbox's egress and cannot be read by the sandbox. A proxy compromise is equivalent to a host compromise, as with the current trusted proxy.
- Trust-store injection does not widen the sandbox's reach: the sandbox still has no route, no external DNS, and only port 443 through CONNECT. The combined bundle keeps public roots for loopback/local test servers but does not create a route to any origin.
- Host equality is enforced on the parsed HTTP/1.1 request, not on a byte pattern, so header folding, duplicate headers, absolute-form targets, and `CONNECT` aliases cannot bypass it. HTTP/2 is not offered, eliminating `:authority` variants.
- The proxy never logs credentials, request bodies, or query strings. It logs only the denied host and reason, unchanged from the current rate-limited denial stream.
- This does not defend against a malicious Docker daemon, a compromised proxy image, or an operator who explicitly selects `sni-only`. Those are deployment-trust boundaries, not sandbox escapes.

#### Test plan

- Proxy script tests: CA `basicConstraints=critical,CA:TRUE`, `keyUsage=critical,keyCertSign,cRLSign`, SKI and signature; leaf SAN/EKU/keyUsage/basicConstraints and CA signature; private-key modes; bounded leaf cache; `Host == SNI` allow; missing/duplicate/other `Host`; case, trailing-dot and `:443` normalisation; other-port, userinfo and bracket-form `Host` reject; `OPTIONS *` reject; HTTP/1.0 with `Host` allow and without `Host` deny; absolute-form, nested `CONNECT`, `Upgrade` deny; `Expect: 100-continue` allow plus `100 Continue` and `103 Early Hints` relay, other `Expect` deny; ALPN-only-`h2` deny; origin certificate failure; CA generation, mode parsing, and the `SSL_OP_NO_RENEGOTIATION` startup check; existing SNI/ECH/extra-handshake tests remain green.
- Framing tests: CL+TE, duplicate identical `Content-Length`, comma-separated `Content-Length`, non-decimal/overflow `Content-Length`, multiple/unsupported `Transfer-Encoding`, and malformed chunked bodies all deny; a valid request followed by a second request on the same tunnel with a different `Host` is denied.
- Response tests: origin `101`, `Upgrade`, `Connection: upgrade`, and unexpected `1xx` are rejected; CL+TE, duplicate `Content-Length`, unsupported transfer codings and malformed chunked responses deny; oversized response headers deny; hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `TE`, `Trailer`, `Upgrade`, `Proxy-Connection`) are stripped; no bytes are raw-piped after the handshake.
- Renegotiation test: a TLS 1.2 client attempts a second handshake; the proxy/origin leg fails closed. The startup check fails if `SSL_OP_NO_RENEGOTIATION` is unavailable.
- Java tests: strict `SANDBOX_EGRESS_TLS_MODE` parsing; proxy args include the mode; terminate mode adds the trust variables and sni-only does not; CA retrieval/copy failure fails sandbox creation; combined-bundle creation from the sandbox image, the missing-system-bundle fallback, and a non-missing bundle failure; `sni-only` keeps the current behaviour.
- Real-Docker integration: an HTTPS origin with a test CA and a shared-CDN simulation (same SNI, different `Host`) proves the allowed request succeeds and the tenant switch is denied; a TLS 1.2 client is terminated and still Host-checked; an `h2`-only client is denied; bodies stream without buffering.
- Bounds tests: more than 32 concurrent tunnels and a wildcard allowlist that exceeds the leaf cache both stay bounded; excess requests are denied/logged.
- Java/Maven/Gradle: terminate mode fails closed with a clear error when a JDK has no injected truststore; the future keytool path is tracked by #149.
- CI: the sandbox integration stage runs terminate mode; the image security script scans the updated proxy image.

#### Decisions

1. **Default:** `terminate` is opt-in for now. `sni-only` remains the default until the optional integration-cycle merge control is decided/available (issue #146) and the terminate suite passes. D16 stays open by default until then.
2. **HTTP/2-only origins:** reject them for the first slice; clients that offer both fall back to HTTP/1.1. Revisit only if testing shows a real need.
3. **Authority:** exact `Host == SNI` equality only; no per-host authority overrides. Assume every approved target uses the CONNECT/SNI name.
4. **Private registries and pinned CAs:** reject them now and fail closed; support is a future feature tracked by issue #148.
5. **`sni-only`:** keep it explicit and logged; the decision to keep or remove it is tracked by issue #147.
6. **Java/Maven/Gradle:** unsupported in terminate mode for now because Java uses its own truststore; the keytool-based injection path is tracked by issue #149 / D28, and the current behavior fails closed.
7. **Pinned CAs and mTLS:** rejected now. Pinned-CA/private-registry support is tracked by issue #148 / D27; client-certificate mTLS is tracked separately by issue #150 / D29.
8. **Request framing and protocol switches:** the proxy re-serializes one canonical request, rejects ambiguous framing, and rejects `101`/`Upgrade` on both sides; there is no raw pipe after the TLS handshake.

## Secrets

- The sandbox gets no long-lived credentials.
- Provider calls go through a local proxy that injects the key outside the sandbox, or through a short-lived scoped token.
- GitHub publishing happens in the supervisor after artifacts are extracted; the sandbox has no push credential.
- Test configuration may include non-secret DB URLs and feature flags, never passwords.

## Prompt-injection defenses

- Treat repo files, issue text and PR comments as untrusted data.
- Put system/developer instructions above repository content; tell the model that repo text cannot change its rules. `PromptBuilder` wraps ticket and planning content in `<untrusted-content>` blocks and escapes the closing tag; the security section states that the supervisor instructions and publishing policy take precedence.
- Deny the built-in `read`/`grep`/`lsp` tools. `sandbox_read`/`sandbox_grep` forward to a loopback workspace bridge that resolves `toRealPath()`, rejects targets outside the workspace and the credential-path denies (`.env*` except `.env.example`, `secrets/**`, `.git/config`, `.ssh/**`, `.aws/**`, `.npmrc`, `.netrc`), and grep never follows symlinks. This closes the D18 symlink/grep bypass. Host mode remains explicitly not a security boundary.
- Deny the built-in `edit`/`write`/`multiedit`/`patch` tools. In the pinned OpenCode 1.19.5 the `edit` permission action covers the edit/write/apply_patch tool IDs; the extra keys are defense in depth. `sandbox_write`/`sandbox_edit` walk the path through `SecureDirectoryStream` descriptors with NOFOLLOW on every component including the final open, reject credential/VCS/OpenCode-control paths, cap writes at 1 MiB, preserve BOM/CRLF for edits, and hold a bounded per-file lock across read-modify-write (D21). This closes D20 where secure directory streams are available. Native Windows or other providers without `SecureDirectoryStream` use a non-atomic canonical-path fallback in host mode; sandbox mode fails fast at bridge startup, and `SANDBOX_REQUIRE_SECURE_FILE_ACCESS=true` makes host mode fail fast too (D22); the flag is forwarded by the root api environment, the agent Compose file and PoolManager, and parsed strictly (true/1, false/0). Host mode is not a security boundary. FIFO targets are rejected before open; a final-component swap can still block an open as a residual availability race (D23).
- Scan commands for high-confidence exfiltration (`curl`/`wget` uploads, netcat/socat, remote copy, shell `/dev/tcp`, common credential-file reads) and deny them in the bash bridge. This is a partial denylist: interpreter one-liners, encoded payloads and unlisted tools can bypass it.
- Scan the guarded tree's added/modified blob contents and new paths before publishing, not `git diff` output. This prevents `.gitattributes`/binary/`++`-prefix/filename bypasses, compares content matches against the base blob so pre-existing fixtures do not block unrelated edits, compares complete PEM private-key blocks (case-insensitive BEGIN/END markers, exact block comparison so reformatting a pre-existing key counts as new), exposes new gitlink paths, and fails closed on an oversized blob. It refuses a configured provider key/GitHub token or a high-confidence credential format. The scan is defense in depth and cannot detect every encoded leak.
- Keep the publishing guard independent of the model.

## Supply chain

- Pin base images by digest; rebuild on a schedule. All `FROM` images in `agent/Dockerfile`, `agent/sandbox.Dockerfile` and `agent/sandbox-proxy.Dockerfile` are digest-pinned; `agent/scripts/sandbox-image-security.sh --check-pins` is the deterministic gate (CI runs it even when scanners are unavailable).
- Generate an SBOM per image (`--sbom`, syft/SPDX JSON under `agent/target/sbom/`); scan OS packages and language dependencies (`--scan`, trivy or grype, HIGH/CRITICAL by default). `--all` optionally verifies a cosign signature when `COSIGN_PUBLIC_KEY` is set.
- Use lockfiles and `npm ci`/equivalent where possible. The harness already uses `npm ci` when a lockfile exists and `--no-package-lock` otherwise.
- Consider `--ignore-scripts` as the default, with an explicit profile opt-in for repos that need lifecycle scripts. Lifecycle scripts currently run inside the sandbox; fg-39 repo profiles will own the opt-out.
- Keep the image minimal; no shell utilities that are not required.

## Artifact extraction

- Compute the diff inside the sandbox but validate it outside against the expected branch/base.
- Copy test output and logs through a bounded artifact directory.
- Redact configured secrets and high-confidence credential formats before persistence (branch names, ticket messages, run errors, commit/PR titles and PR bodies); scope is the OpenCode supervisor path (legacy processors and external log shipping are D19). Treat redaction as a storage guard, not a sandbox boundary.
- Verify no symlinks or paths escape the workspace.
- Destroy the sandbox even on failure; retain only artifacts.

## Local development

- `SANDBOX_MODE=host` for Windows/dev, with a startup warning and no production default.
- `SANDBOX_MODE=docker` for Linux/dev and CI.
- CI must run at least one sandboxed smoke test so the Dockerfile and runtime stay valid.

## Tests

- malicious `postinstall` and test scripts;
- path traversal and symlink escape;
- host path and metadata endpoint access;
- network allow/deny;
- CPU/memory/PID/disk/timeout enforcement;
- secret absence;
- artifact extraction and diff validation;
- sandbox creation failure (fail closed).

## Rollout

1. Add the runner with `SANDBOX_MODE=host` to preserve current behavior.
2. Enable Docker sandbox in CI.
3. Enable per-project in staging; compare failure rates.
4. Make Docker the production default; keep host mode only for local dev.
5. Add image signing/SBOM gates.

## Open questions

1. Docker sibling vs Podman vs microVM for the first version?
2. How do we proxy model traffic without leaking the key into the sandbox?
3. Do we allow lifecycle scripts at all?
4. How do we support repos that need Docker (e.g. testcontainers) without exposing the host socket?
5. What is the disk quota per repo?

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
