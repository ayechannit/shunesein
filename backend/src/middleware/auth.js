const jwt = require('jsonwebtoken');
const db = require('../config/db');

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(403).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
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

module.exports = { verifyToken, checkPermission };
