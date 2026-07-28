const db = require('../config/db');
const logAction = require('../utils/auditLogger');

class DashboardController {
  getDashboardStats = async (req, res) => {
    try {
      // Aggregate key metrics
      const stats = await db.query(`
        SELECT 
          (SELECT SUM(total_amount) FROM sales_invoices WHERE invoice_date = CURRENT_DATE) as daily_sales,
          (SELECT COUNT(*) FROM purchase_orders WHERE status = 'pending') as pending_pos,
          (SELECT COUNT(*) FROM stock_levels WHERE quantity <= 10) as low_stock_items
      `);
      res.json(stats.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new DashboardController();
