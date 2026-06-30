#!/usr/bin/env node
/**
 * Data migration: populate provider_configs.api_key_encrypted from existing credentials
 *
 * Run: node backend/src/migrations/migrate_provider_api_keys.js
 *
 * This reads existing api_key_credential_id references from provider_configs,
 * fetches the encrypted API key from project_credentials, decrypts it,
 * and stores it in the new api_key_encrypted column.
 */

require('dotenv').config();
const { Pool } = require('pg');
const { decrypt } = require('../utils/crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  family: 4,
});

async function migrate() {
  try {
    // Find provider configs with existing credential references
    const { rows } = await pool.query(
      `SELECT pc.id, pc.api_key_credential_id, pc.project_id
       FROM provider_configs pc
       WHERE pc.api_key_credential_id IS NOT NULL`
    );

    if (rows.length === 0) {
      console.log('No provider configs with api_key_credential_id found. Nothing to migrate.');
      return;
    }

    console.log(`Found ${rows.length} provider config(s) with api_key_credential_id references.`);

    let migrated = 0;
    let skipped = 0;

    for (const row of rows) {
      // Fetch the credential
      const { rows: credRows } = await pool.query(
        `SELECT key_encrypted FROM project_credentials WHERE id = $1`,
        [row.api_key_credential_id]
      );

      if (credRows.length === 0) {
        console.log(`  Skip: credential ${row.api_key_credential_id} not found for provider_config ${row.id}`);
        skipped++;
        continue;
      }

      // Decrypt and store
      const encryptedKey = credRows[0].key_encrypted;
      const decryptedKey = decrypt(encryptedKey);

      if (!decryptedKey || decryptedKey === '') {
        console.log(`  Skip: could not decrypt credential ${row.api_key_credential_id} for provider_config ${row.id}`);
        skipped++;
        continue;
      }

      await pool.query(
        `UPDATE provider_configs SET api_key_encrypted = $1 WHERE id = $2`,
        [decryptedKey, row.id]
      );

      console.log(`  Migrated: provider_config ${row.id} — key stored (${decryptedKey.length} chars)`);
      migrated++;
    }

    console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped.`);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
