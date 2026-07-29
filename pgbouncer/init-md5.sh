#!/bin/bash
set -e

# PostgreSQL entrypoint sets POSTGRES_PASSWORD during initdb using default
# password_encryption (scram-sha-256). We need md5 to match pgbouncer's
# userlist.txt. Re-hash here after init but before server starts.

if [ -n "$POSTGRES_PASSWORD" ]; then
    until pg_isready -U postgres; do
        sleep 1
    done
    
    PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -c "SET password_encryption = 'md5'; ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';"
fi
