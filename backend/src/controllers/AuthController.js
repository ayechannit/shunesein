const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logAction = require('../utils/auditLogger');

class AuthController {
  login = async (req, res) => {
    try {
      const { username, password } = req.body;
      const query = `
        SELECT u.*, r.name as role_name
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.username = $1 AND u.status = 'active'
      `;
      const result = await db.query(query, [username]);

      if (result.rows.length === 0) {
        await logAction(null, 'LOGIN_FAILED', 'users', null, null, { attempted_username: username });
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const user = result.rows[0];
      const isMatch = await bcrypt.compare(password, user.password_hash);

      if (!isMatch) {
        await logAction(user.id, 'LOGIN_FAILED', 'users', user.id, null, { attempted_username: username });
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, role_id: user.role_id, role_name: user.role_name },
        process.env.JWT_SECRET || 'your_jwt_secret',
        { expiresIn: '1d' }
      );

      // Update last login
      await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
      await logAction(user.id, 'LOGIN', 'users', user.id, null, null);

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role_name: user.role_name,
          timezone: user.timezone || 'UTC'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Purely an audit entry - JWTs are stateless here so there's no server-side
  // session to invalidate, but "who logged out and when" still matters for
  // the activity trail the quotation asks for.
  logout = async (req, res) => {
    try {
      await logAction(req.user.id, 'LOGOUT', 'users', req.user.id, null, null);
      res.json({ message: 'Logged out' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // The JWT payload only ever carries id/username/role - it's signed once at
  // login and doesn't reflect later profile edits (like a timezone change)
  // until the next login. This is how the app reads "my own current
  // profile" without waiting for that.
  getProfile = async (req, res) => {
    try {
      const result = await db.query(
        'SELECT id, username, full_name, role_id, status, timezone FROM users WHERE id = $1',
        [req.user.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
      res.json({ user: result.rows[0] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Self-service profile update - deliberately not gated by manage_users:
  // every user, regardless of role, can set their own display name and
  // timezone. Anything requiring the admin-only permission (username,
  // role, status) stays on the existing UserController routes.
  updateProfile = async (req, res) => {
    try {
      const userId = req.user.id;
      const { full_name, timezone } = req.body;

      const result = await db.query(
        `UPDATE users SET full_name = COALESCE($1, full_name), timezone = COALESCE($2, timezone), updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 RETURNING id, username, full_name, role_id, status, timezone`,
        [full_name ?? null, timezone ?? null, userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });

      await logAction(userId, 'UPDATE', 'users', userId, null, result.rows[0]);
      res.json({ user: result.rows[0] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  changePassword = async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body;
      const userId = req.user.id;

      const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      const user = result.rows[0];

      const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
      if (!isMatch) return res.status(400).json({ message: 'Incorrect old password' });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new AuthController();
