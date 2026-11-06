#!/usr/bin/env bash
#
# Supply-chain checks for the fg-34 sandbox images.
#
# The deterministic gate is `--check-pins`: every FROM line in the sandbox,
# proxy and supervisor Dockerfiles must reference a base image by digest.
# SBOM generation and vulnerability scanning use syft/trivy/grype when they are
# installed; set SANDBOX_SCAN_REQUIRED=1 in CI to fail instead of skipping.
#
# Usage:
#   scripts/sandbox-image-security.sh --check-pins [--dockerfile FILE ...]
#   scripts/sandbox-image-security.sh --sbom IMAGE [OUT]
#   scripts/sandbox-image-security.sh --scan IMAGE
#   scripts/sandbox-image-security.sh --sbom-and-scan IMAGE [OUT]
#   scripts/sandbox-image-security.sh --all IMAGE [OUT]
#
# Environment:
#   SANDBOX_SCAN_SEVERITY   trivy severities (default: HIGH,CRITICAL)
#   SANDBOX_SCAN_FAIL_ON    grype failure threshold (default: high)
#   SANDBOX_SCAN_REQUIRED   "1" fails when no scanner is installed
#   COSIGN_PUBLIC_KEY       public key for optional signature verification
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_DOCKERFILES=(
    "$ROOT/sandbox.Dockerfile"
    "$ROOT/sandbox-proxy.Dockerfile"
    "$ROOT/Dockerfile"
)
SCAN_SEVERITY="${SANDBOX_SCAN_SEVERITY:-HIGH,CRITICAL}"
SCAN_FAIL_ON="${SANDBOX_SCAN_FAIL_ON:-high}"

usage() {
    cat <<'EOF'
Supply-chain checks for the fg-34 sandbox images.

The deterministic gate is --check-pins: every FROM line in the sandbox,
proxy and supervisor Dockerfiles must reference a base image by digest.
SBOM generation and vulnerability scanning use syft/trivy/grype when they
are installed; set SANDBOX_SCAN_REQUIRED=1 in CI to fail instead of skipping.

Usage:
  scripts/sandbox-image-security.sh --check-pins [--dockerfile FILE ...]
  scripts/sandbox-image-security.sh --sbom IMAGE [OUT]
  scripts/sandbox-image-security.sh --scan IMAGE
  scripts/sandbox-image-security.sh --sbom-and-scan IMAGE [OUT]
  scripts/sandbox-image-security.sh --all IMAGE [OUT]

Environment:
  SANDBOX_SCAN_SEVERITY   trivy severities (default: HIGH,CRITICAL)
  SANDBOX_SCAN_FAIL_ON    grype failure threshold (default: high)
  SANDBOX_SCAN_REQUIRED   "1" fails when no scanner is installed
  COSIGN_PUBLIC_KEY       public key for optional signature verification
EOF
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "error: '$1' is required but not installed" >&2
        exit 2
    fi
}

check_pins() {
    local failed=0
    local file
    for file in "${DOCKERFILES[@]}"; do
        if [[ ! -f "$file" ]]; then
            echo "error: Dockerfile not found: $file" >&2
            failed=1
            continue
        fi
        while IFS= read -r line; do
            if [[ "$line" =~ ^[[:space:]]*FROM[[:space:]] ]]; then
                if [[ "$line" =~ FROM[[:space:]]+scratch([[:space:]]|$) ]]; then
                    continue
                fi
                if [[ ! "$line" =~ @sha256:[0-9a-f]{64}([[:space:]]|$) ]]; then
                    echo "unpinned base image in ${file#"$ROOT"/}: $line" >&2
                    failed=1
                fi
            fi
        done < "$file"
    done
    if [[ "$failed" -ne 0 ]]; then
        echo "supply-chain gate failed: pin every FROM image by digest" >&2
        return 1
    fi
    echo "all Dockerfile base images are digest-pinned"
}

default_sbom_path() {
    local image="$1"
    local safe
    safe="$(printf '%s' "$image" | tr '/:@' '___')"
    printf '%s/target/sbom/%s.spdx.json' "$ROOT" "$safe"
}

generate_sbom() {
    local image="$1"
    local out="${2:-$(default_sbom_path "$image")}"
    require_command syft
    mkdir -p "$(dirname "$out")"
    syft "$image" -o spdx-json > "$out"
    echo "SBOM written to $out"
}

scan_image() {
    local image="$1"
    if command -v trivy >/dev/null 2>&1; then
        trivy image --quiet --exit-code 1 \
            --severity "$SCAN_SEVERITY" --ignore-unfixed "$image"
        echo "trivy scan passed ($SCAN_SEVERITY)"
    elif command -v grype >/dev/null 2>&1; then
        grype "$image" --fail-on "$SCAN_FAIL_ON"
        echo "grype scan passed (fail-on $SCAN_FAIL_ON)"
    elif [[ "${SANDBOX_SCAN_REQUIRED:-0}" == "1" ]]; then
        echo "error: no image scanner installed (trivy or grype required)" >&2
        exit 2
    else
        echo "warning: no image scanner installed; SBOM/scan gate skipped" >&2
    fi
}

verify_signature() {
    local image="$1"
    if [[ -z "${COSIGN_PUBLIC_KEY:-}" ]]; then
        echo "warning: COSIGN_PUBLIC_KEY is not set; signature verification skipped" >&2
        return 0
    fi
    require_command cosign
    cosign verify --key "$COSIGN_PUBLIC_KEY" "$image"
    echo "cosign signature verified"
}

main() {
    if [[ $# -lt 1 ]]; then
        usage
        exit 2
    fi

    local mode="$1"
    shift
    case "$mode" in
        -h|--help)
            usage
            ;;
        --check-pins)
            DOCKERFILES=("${DEFAULT_DOCKERFILES[@]}")
            while [[ $# -gt 0 ]]; do
                case "$1" in
                    --dockerfile)
                        if [[ $# -lt 2 ]]; then
                            echo "error: --dockerfile needs a path" >&2
                            exit 2
                        fi
                        if [[ ${#DOCKERFILES[@]} -eq ${#DEFAULT_DOCKERFILES[@]} ]]; then
                            DOCKERFILES=()
                        fi
                        DOCKERFILES+=("$2")
                        shift 2
                        ;;
                    *)
                        echo "error: unknown option: $1" >&2
                        exit 2
                        ;;
                esac
            done
            check_pins
            ;;
        --sbom)
            if [[ $# -lt 1 || $# -gt 2 ]]; then
                echo "error: --sbom needs IMAGE [OUT]" >&2
                exit 2
            fi
            generate_sbom "$1" "${2:-}"
            ;;
        --scan)
            if [[ $# -ne 1 ]]; then
                echo "error: --scan needs IMAGE" >&2
                exit 2
            fi
            scan_image "$1"
            ;;
        --sbom-and-scan)
            if [[ $# -lt 1 || $# -gt 2 ]]; then
                echo "error: --sbom-and-scan needs IMAGE [OUT]" >&2
                exit 2
            fi
            generate_sbom "$1" "${2:-}"
            scan_image "$1"
            ;;
        --all)
            if [[ $# -lt 1 || $# -gt 2 ]]; then
                echo "error: --all needs IMAGE [OUT]" >&2
                exit 2
            fi
            check_pins
            generate_sbom "$1" "${2:-}"
            scan_image "$1"
            verify_signature "$1"
            ;;
        *)
            echo "error: unknown mode: $mode" >&2
            usage
            exit 2
            ;;
    esac
}

main "$@"
