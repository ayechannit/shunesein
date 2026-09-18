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

  // Get price levels this role can use in Sales
  getRolePriceLevels = async (req, res) => {
    try {
      const { id } = req.params;
      const query = `
        SELECT pl.*
        FROM price_levels pl
        JOIN role_price_levels rpl ON pl.id = rpl.price_level_id
        WHERE rpl.role_id = $1
      `;
      const result = await db.query(query, [id]);
      res.json(result.rows);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Assign price levels to a role - same replace-all-on-save contract as
  // assignPermissions above.
  assignPriceLevels = async (req, res) => {
    try {
      const { id } = req.params; // role_id
      const { priceLevelIds } = req.body;

      await db.withTransaction(async (client) => {
        await client.query('DELETE FROM role_price_levels WHERE role_id = $1', [id]);

        if (priceLevelIds && priceLevelIds.length > 0) {
          for (const levelId of priceLevelIds) {
            await client.query('INSERT INTO role_price_levels (role_id, price_level_id) VALUES ($1, $2)', [id, levelId]);
          }
        }
      });

      res.json({ message: 'Price levels assigned successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new RoleController();
