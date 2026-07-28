const db = require('../config/db');
const logAction = require('../utils/auditLogger');

const ALLOWED_SORT = ['id', 'timestamp', 'action', 'target_table', 'user_id'];

class AuditController {
  // List Audit Logs, filterable by user, table, action, and date range - a
  // "high-security activity tracker" is only useful if you can actually
  // narrow down what you're looking for once it has thousands of rows.
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 20, search = '', sortBy = 'timestamp', order = 'DESC', user_id, target_table, action, from, to } = req.query;
      const offset = (page - 1) * limit;
      const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'timestamp';
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const conditions = [];
      const params = [];

      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(al.action ILIKE $${params.length} OR al.target_table ILIKE $${params.length})`);
      }
      if (user_id) {
        params.push(user_id);
        conditions.push(`al.user_id = $${params.length}`);
      }
      if (target_table) {
        params.push(target_table);
        conditions.push(`al.target_table = $${params.length}`);
      }
      if (action) {
        params.push(action);
        conditions.push(`al.action = $${params.length}`);
      }
      if (from) {
        params.push(from);
        conditions.push(`al.timestamp >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`al.timestamp <= $${params.length}::date + interval '1 day'`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const dataQuery = `
        SELECT al.*, u.username
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        ${whereClause}
        ORDER BY al.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM audit_logs al ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Self-reported log entry for actions that only happen client-side (e.g.
  // opening a print view) - there's nothing on the server to hook into for
  // these, so the frontend reports them after the fact.
  logPrint = async (req, res) => {
    try {
      const { target_table, target_id, reference } = req.body;
      await logAction(req.user.id, 'PRINT', target_table || 'document', target_id || null, null, reference ? { reference } : null);
      res.status(201).json({ message: 'Print logged' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new AuditController();
