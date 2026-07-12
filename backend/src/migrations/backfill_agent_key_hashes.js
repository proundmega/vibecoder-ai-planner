#!/usr/bin/env node
/**
 * Data migration: bcrypt-hash existing plaintext api_keys into api_key_hash
 *
 * Run: node backend/src/migrations/backfill_agent_key_hashes.js
 *
 * This reads all agents with plaintext api_key values, bcrypt-hashes them,
 * and stores the hash in api_key_hash and the first 12 chars in api_key_hash_prefix.
 * After this migration, api_key can be safely NULL'd for security.
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;
const PREFIX_LENGTH = 12;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  family: 4,
});

async function migrate() {
  try {
    // Find agents with plaintext api_key but no hash
    const { rows } = await pool.query(
      `SELECT id, name, api_key
       FROM agents
       WHERE api_key IS NOT NULL AND api_key_hash IS NULL`
    );

    if (rows.length === 0) {
      console.log('No agents need key hash backfill. Skipping.');
      return;
    }

    console.log(`Found ${rows.length} agent(s) needing api_key hash backfill.`);

    let hashed = 0;
    let skipped = 0;

    for (const agent of rows) {
      try {
        const hash = await bcrypt.hash(agent.api_key, SALT_ROUNDS);
        const prefix = hash.substring(0, PREFIX_LENGTH);
        await pool.query(
          'UPDATE agents SET api_key_hash = $1, api_key_hash_prefix = $2 WHERE id = $3',
          [hash, prefix, agent.id]
        );
        console.log(`  Hashed: agent ${agent.id} (${agent.name}) — prefix: ${prefix}`);
        hashed++;
      } catch (err) {
        console.error(`  Error hashing agent ${agent.id}: ${err.message}`);
        skipped++;
      }
    }

    console.log(`\nBackfill complete: ${hashed} hashed, ${skipped} skipped.`);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
