const db = require('../config/db');

// The Settings screen only ever updates a fixed, pre-seeded set of keys -
// there's no "create a new setting" or "delete a setting" affordance, so an
// update is rejected outright if it names something outside this list rather
// than silently creating a stray row.
const ALLOWED_KEYS = [
  'print_margin_top',
  'print_margin_bottom',
  'print_margin_left',
  'print_margin_right',
  'print_page_width',
  'print_page_height',
];

class SettingsController {
  getSettings = async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM system_settings ORDER BY key');
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Accepts either a single { key, value } or a batch { settings: { key: value, ... } }
  // so a form with several fields can save in one request.
  updateSetting = async (req, res) => {
    const { key, value, settings } = req.body;
    const entries = settings && typeof settings === 'object' ? Object.entries(settings) : [[key, value]];

    const invalidKey = entries.find(([entryKey]) => !ALLOWED_KEYS.includes(entryKey));
    if (invalidKey) {
      return res.status(400).json({ message: `Unknown setting: ${invalidKey[0]}` });
    }

    try {
      for (const [entryKey, entryValue] of entries) {
        await db.query(
          'INSERT INTO system_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP',
          [entryKey, entryValue]
        );
      }
      res.json({ message: 'Settings updated' });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new SettingsController();
