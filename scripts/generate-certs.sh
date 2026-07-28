#!/usr/bin/env bash
set -e

# Create certs directory
mkdir -p pgbouncer/certs

# Generate CA
openssl genrsa -out pgbouncer/certs/ca.key 4096
openssl req -new -x509 -days 3650 -key pgbouncer/certs/ca.key \
  -out pgbouncer/certs/ca.crt \
  -subj "/CN=Vibecode CA"

# Generate server key and CSR
openssl genrsa -out pgbouncer/certs/server.key 4096
openssl req -new -key pgbouncer/certs/server.key \
  -out pgbouncer/certs/server.csr \
  -subj "/CN=pgbouncer"

# Sign server cert with CA
openssl x509 -req -days 3650 \
  -in pgbouncer/certs/server.csr \
  -CA pgbouncer/certs/ca.crt \
  -CAkey pgbouncer/certs/ca.key \
  -CAcreateserial \
  -out pgbouncer/certs/server.crt

# Set permissions
chmod 600 pgbouncer/certs/server.key
chmod 644 pgbouncer/certs/ca.crt pgbouncer/certs/server.crt

echo "Certificates generated in pgbouncer/certs/"
echo "  - ca.crt (CA certificate)"
echo "  - ca.key (CA private key)"
echo "  - server.crt (server certificate)"
echo "  - server.key (server private key)"
