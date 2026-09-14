#!/usr/bin/env node
// Applies every .sql file under database/migrations/ that isn't already
// recorded in schema_migrations, in filename order (001_, 002_, ... sort
// correctly as plain strings since they're all zero-padded to the same
// width). Previously these were applied by hand with no record of what had
// actually run where - this doesn't change how migrations are written (they
// still need to be idempotent/IF NOT EXISTS-guarded, same convention as
// every migration already in this folder), it just gives a reliable answer
// to "what's live on this database" and stops the same file from being run
// twice.
//
// Usage: npm run migrate

const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');

const run = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const appliedResult = await db.query('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((row) => row.filename));

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('Up to date - no pending migrations.');
    return;
  }

  console.log(`Applying ${pending.length} migration(s): ${pending.join(', ')}`);

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.withTransaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      });
      console.log(`  applied: ${file}`);
    } catch (error) {
      console.error(`  FAILED: ${file}`);
      console.error(`  ${error.message}`);
      console.error('Stopping - fix the error above before re-running (already-applied migrations above this one are recorded and will be skipped next time).');
      process.exitCode = 1;
      return;
    }
  }

  console.log('Done.');
};

run()
  .catch((error) => {
    console.error('Migration runner failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
