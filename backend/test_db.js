const { pool } = require('./src/config/db');

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('Database connection successful!');
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
