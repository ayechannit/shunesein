const db = require('../config/db');
const bcrypt = require('bcryptjs');
const MasterDataController = require('./MasterDataController');
const logAction = require('../utils/auditLogger');

class UserController extends MasterDataController {
  constructor() {
    super('users', ['username', 'full_name']);
  }

  // Override create to hash password
  create = async (req, res) => {
    try {
      const { username, password, full_name, role_id, status, timezone } = req.body;
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);

      const query = `
        INSERT INTO users (username, password_hash, full_name, role_id, status, timezone)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, username, full_name, role_id, status, timezone, created_at
      `;

      const result = await db.query(query, [username, password_hash, full_name, role_id, status || 'active', timezone || 'UTC']);
      await logAction(req.user?.id, 'CREATE', 'users', result.rows[0].id, null, result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Override update to handle optional password update
  update = async (req, res) => {
    try {
      const { id } = req.params;
      
      const oldResult = await db.query('SELECT id, username, full_name, role_id, status, timezone FROM users WHERE id = $1', [id]);
      if (oldResult.rows.length === 0) return res.status(404).json({ message: 'User not found' });
      const oldRecord = oldResult.rows[0];

      const { username, password, full_name, role_id, status, timezone } = req.body;

      let query;
      let params;

      if (password) {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        query = `
          UPDATE users
          SET username = $1, password_hash = $2, full_name = $3, role_id = $4, status = $5, timezone = $6, updated_at = CURRENT_TIMESTAMP
          WHERE id = $7 RETURNING id, username, full_name, role_id, status, timezone
        `;
        params = [username, password_hash, full_name, role_id, status, timezone || 'UTC', id];
      } else {
        query = `
          UPDATE users
          SET username = $1, full_name = $2, role_id = $3, status = $4, timezone = $5, updated_at = CURRENT_TIMESTAMP
          WHERE id = $6 RETURNING id, username, full_name, role_id, status, timezone
        `;
        params = [username, full_name, role_id, status, timezone || 'UTC', id];
      }

      const result = await db.query(query, params);
      await logAction(req.user?.id, 'UPDATE', 'users', id, oldRecord, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // List users with role names
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'ASC' } = req.query;
      const offset = (page - 1) * limit;

      // sortBy/order come straight from query params - never interpolate them
      // into SQL without an allowlist, unlike page/limit below which are safe
      // because arithmetic coercion turns any non-numeric input into NaN
      // (a syntax error, not an injection vector).
      const allowedSortColumns = { id: 'u.id', username: 'u.username', full_name: 'u.full_name', role_name: 'role_name', status: 'u.status', timezone: 'u.timezone', last_login: 'u.last_login', created_at: 'u.created_at' };
      const safeSortBy = allowedSortColumns[sortBy] || 'u.id';
      const safeOrder = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

      let whereClause = '';
      let params = [];

      if (search) {
        whereClause = 'WHERE u.username ILIKE $1 OR u.full_name ILIKE $1';
        params.push(`%${search}%`);
      }

      const dataQuery = `
        SELECT u.id, u.username, u.full_name, u.role_id, r.name as role_name, u.status, u.timezone, u.last_login, u.created_at
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        ${whereClause}
        ORDER BY ${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;

      const countResult = await db.query(`SELECT COUNT(*) FROM users u ${whereClause}`, params);

      const dataResult = await db.query(dataQuery, params);

      res.json({
        data: dataResult.rows,
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        limit: parseInt(limit)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new UserController();
