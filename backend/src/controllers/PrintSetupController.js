const db = require('../config/db');
const MasterDataController = require('./MasterDataController');
const logAction = require('../utils/auditLogger');

class PrintSetupController extends MasterDataController {
  constructor() {
    super('print_page_setups', ['name']);
  }

  // Overrides create/update to handle is_default exclusively: the generic
  // insert/update the base class would otherwise run can't clear every
  // other row's is_default first, and the partial unique index (see
  // migration 018) would reject a second row simply saved with the
  // checkbox on rather than explaining why.
  create = async (req, res) => {
    try {
      const { name, margin_top, margin_bottom, margin_left, margin_right, page_width, page_height, is_default } = req.body;

      const record = await db.withTransaction(async (client) => {
        if (is_default) {
          await client.query('UPDATE print_page_setups SET is_default = false WHERE is_default = true');
        }
        const result = await client.query(
          `INSERT INTO print_page_setups (name, margin_top, margin_bottom, margin_left, margin_right, page_width, page_height, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [name, margin_top, margin_bottom, margin_left, margin_right, page_width, page_height, Boolean(is_default)]
        );
        return result.rows[0];
      });

      await logAction(req.user?.id, 'CREATE', 'print_page_setups', record.id, null, record);
      res.status(201).json(record);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  update = async (req, res) => {
    try {
      const { id } = req.params;
      const { name, margin_top, margin_bottom, margin_left, margin_right, page_width, page_height, is_default } = req.body;

      const oldResult = await db.query('SELECT * FROM print_page_setups WHERE id = $1', [id]);
      if (oldResult.rows.length === 0) return res.status(404).json({ message: 'Print page setup not found' });

      const record = await db.withTransaction(async (client) => {
        if (is_default) {
          await client.query('UPDATE print_page_setups SET is_default = false WHERE is_default = true AND id != $1', [id]);
        }
        const result = await client.query(
          `UPDATE print_page_setups
           SET name = $1, margin_top = $2, margin_bottom = $3, margin_left = $4, margin_right = $5, page_width = $6, page_height = $7, is_default = $8
           WHERE id = $9 RETURNING *`,
          [name, margin_top, margin_bottom, margin_left, margin_right, page_width, page_height, Boolean(is_default), id]
        );
        return result.rows[0];
      });

      await logAction(req.user?.id, 'UPDATE', 'print_page_setups', id, oldResult.rows[0], record);
      res.json(record);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // One-click "make this the default" without opening the edit form.
  setDefault = async (req, res) => {
    try {
      const { id } = req.params;

      const record = await db.withTransaction(async (client) => {
        const existing = await client.query('SELECT * FROM print_page_setups WHERE id = $1', [id]);
        if (existing.rows.length === 0) throw new Error('NOT_FOUND');

        await client.query('UPDATE print_page_setups SET is_default = false WHERE is_default = true AND id != $1', [id]);
        const result = await client.query('UPDATE print_page_setups SET is_default = true WHERE id = $1 RETURNING *', [id]);
        return result.rows[0];
      });

      await logAction(req.user?.id, 'UPDATE', 'print_page_setups', id, null, record);
      res.json(record);
    } catch (error) {
      if (error.message === 'NOT_FOUND') return res.status(404).json({ message: 'Print page setup not found' });
      res.status(500).json({ error: error.message });
    }
  };

  // Deleting the current default would leave nothing marked default at all -
  // block it rather than silently leaving every future print with no
  // fallback until someone notices and picks a new one.
  delete = async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query('SELECT * FROM print_page_setups WHERE id = $1', [id]);
      if (existing.rows.length === 0) return res.status(404).json({ message: 'Print page setup not found' });
      if (existing.rows[0].is_default) {
        return res.status(400).json({ message: 'Cannot delete the default print page setup. Make another setup the default first.' });
      }

      await db.query('DELETE FROM print_page_setups WHERE id = $1', [id]);
      await logAction(req.user?.id, 'DELETE', 'print_page_setups', id, existing.rows[0], null);
      res.json({ message: 'Print page setup deleted' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new PrintSetupController();
