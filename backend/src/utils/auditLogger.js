const db = require('../config/db');

const logAction = async (user_id, action, target_table, target_id, old_value = null, new_value = null) => {
  try {
    const actorId = user_id && Number.isFinite(Number(user_id)) ? Number(user_id) : null;
    await db.query(
      `INSERT INTO audit_logs (user_id, action, target_table, target_id, old_value, new_value) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, action, target_table, target_id, JSON.stringify(old_value), JSON.stringify(new_value)]
    );
  } catch (error) {
    console.error('Audit log failed:', error);
  }
};

module.exports = logAction;
