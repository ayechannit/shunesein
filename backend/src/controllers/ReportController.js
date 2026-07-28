const db = require('../config/db');

class ReportController {
  // Current Stock Report
  getCurrentStock = async (req, res) => {
    try {
      const query = `
        SELECT p.name as product_name, p.product_code, w.name as warehouse_name, sl.quantity
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        JOIN warehouses w ON sl.warehouse_id = w.id
        ORDER BY w.name, p.name
      `;
      const result = await db.query(query);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Low Stock Report
  getLowStock = async (req, res) => {
    try {
      const query = `
        SELECT p.name as product_name, p.min_stock_level, w.name as warehouse_name, sl.quantity
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        JOIN warehouses w ON sl.warehouse_id = w.id
        WHERE sl.quantity <= p.min_stock_level
      `;
      const result = await db.query(query);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Sales Summary Report
  getSalesSummary = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const query = `
        SELECT SUM(total_amount) as total_sales, COUNT(*) as invoice_count
        FROM sales_invoices
        WHERE invoice_date BETWEEN $1 AND $2
      `;
      const result = await db.query(query, [startDate, endDate]);
      res.json(result.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Profit & Loss Report (Simplified)
  getProfitLoss = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const query = `
        SELECT 
          (SELECT SUM(total_amount) FROM sales_invoices WHERE invoice_date BETWEEN $1 AND $2) as total_revenue,
          (SELECT SUM(total_amount) FROM purchase_vouchers WHERE voucher_date BETWEEN $1 AND $2) as total_cogs
      `;
      const result = await db.query(query, [startDate, endDate]);
      const { total_revenue, total_cogs } = result.rows[0];
      res.json({
        total_revenue: parseFloat(total_revenue || 0),
        total_cogs: parseFloat(total_cogs || 0),
        gross_profit: parseFloat(total_revenue || 0) - parseFloat(total_cogs || 0)
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new ReportController();
