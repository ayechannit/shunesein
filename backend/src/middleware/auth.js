const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { JWT_SECRET } = require('../config/jwt');

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(403).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

const checkPermission = (permissionName) => {
  return async (req, res, next) => {
    try {
      const { role_id } = req.user;
      const query = `
        SELECT p.name 
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.name = $2
      `;
      const result = await db.query(query, [role_id, permissionName]);

      if (result.rows.length === 0) {
        return res.status(403).json({ message: 'Permission denied' });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
};

// For permission checks that depend on the record's state (e.g. "may edit
// even though it's paid"), which a route-level checkPermission can't express.
const roleHasPermission = async (roleId, permissionName) => {
  if (!roleId) return false;
  const result = await db.query(
    `SELECT 1 FROM permissions p
     JOIN role_permissions rp ON p.id = rp.permission_id
     WHERE rp.role_id = $1 AND p.name = $2`,
    [roleId, permissionName]
  );
  return result.rows.length > 0;
};

module.exports = { verifyToken, checkPermission, roleHasPermission };
