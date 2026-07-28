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
          role_name: user.role_name
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
