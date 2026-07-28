const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DB_URL 
  ? { connectionString: process.env.DB_URL }
  : {
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'shunesein',
      password: process.env.DB_PASSWORD || 'postgres',
      port: process.env.DB_PORT || 5432,
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
