const db = require('../config/db');
const MasterDataController = require('./MasterDataController');

class RoleController extends MasterDataController {
  constructor() {
    super('roles', ['name']);
  }

  // Get permissions for a role
  getRolePermissions = async (req, res) => {
    try {
      const { id } = req.params;
      const query = `
        SELECT p.* 
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = $1
      `;
      const result = await db.query(query, [id]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Assign permissions to a role
  assignPermissions = async (req, res) => {
    try {
      const { id } = req.params; // role_id
      const { permissionIds } = req.body; // array of permission IDs

      await db.withTransaction(async (client) => {
        await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);

        if (permissionIds && permissionIds.length > 0) {
          for (const pId of permissionIds) {
            await client.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)', [id, pId]);
          }
        }
      });

      res.json({ message: 'Permissions assigned successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new RoleController();
