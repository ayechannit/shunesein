const { Pool } = require('pg');
require('dotenv').config();

// '-c timezone=UTC' pins every connection's session timezone explicitly,
// rather than relying on the host's default (which happens to be UTC on
// Supabase today, but nothing before this line guaranteed it - see the
// UTC datetime architecture doc).
//
// max/idleTimeoutMillis matter a lot more here than on a long-lived server:
// each Vercel serverless invocation can spin up its own process (and thus
// its own pool), so an uncapped pool per-instance is how you exhaust a
// hosted Postgres's connection limit under concurrent traffic. Keeping each
// instance's pool small and quick to release connections, and pointing
// DB_URL at a connection pooler (e.g. Supabase's port 6543 PgBouncer
// endpoint, not the direct 5432 one) rather than raising this number, is
// the actual fix for that class of problem.
const pool = new Pool(
  process.env.DB_URL
  ? {
      connectionString: process.env.DB_URL,
      options: '-c timezone=UTC',
      max: parseInt(process.env.DB_POOL_MAX, 10) || 5,
      idleTimeoutMillis: 10000,
    }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'shunesein',
      password: process.env.DB_PASSWORD || 'postgres',
      port: process.env.DB_PORT || 5432,
      options: '-c timezone=UTC',
      max: parseInt(process.env.DB_POOL_MAX, 10) || 5,
      idleTimeoutMillis: 10000,
    }
);

// pool.query() may hand out a different connection per call, so a bare
// BEGIN/COMMIT sequence of separate db.query() calls is not guaranteed to run
// on one connection. Use this helper when a block of statements must be atomic.
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  withTransaction,
};
