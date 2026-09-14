const db = require('../config/db');

// `dbClient` defaults to the shared pool for the many call sites that log
// outside any transaction (login, logout, single-statement CRUD). Pass the
// transaction's own client when logging from inside a db.withTransaction()
// callback - both expose the same .query(text, params) interface, so this
// is a transparent substitution. Without this, an audit entry written via
// the pool commits immediately on its own connection even if the enclosing
// business transaction later rolls back, so you'd get an audit entry for a
// change that never persisted (or the reverse, on a rollback after a later
// step failed).
const logAction = async (user_id, action, target_table, target_id, old_value = null, new_value = null, dbClient = db) => {
  try {
    const actorId = user_id && Number.isFinite(Number(user_id)) ? Number(user_id) : null;
    await dbClient.query(
      `INSERT INTO audit_logs (user_id, action, target_table, target_id, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, action, target_table, target_id, JSON.stringify(old_value), JSON.stringify(new_value)]
    );
  } catch (error) {
    console.error('Audit log failed:', error);
  }
};

module.exports = logAction;
