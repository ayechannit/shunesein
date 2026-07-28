const db = require('../config/db');

class StockLedgerController {
  // Get Stock Balance as of a specific date
  getStockBalanceAtDate = async (req, res) => {
    const { date, product_id, warehouse_id } = req.query;
    try {
      // Balance = Sum of all transactions up to that date
      const query = `
        SELECT 
          p.name as product_name, 
          w.name as warehouse_name, 
          SUM(quantity_change) as balance
        FROM stock_transactions st
        JOIN products p ON st.product_id = p.id
        JOIN warehouses w ON st.warehouse_id = w.id
        WHERE st.created_at <= $1
        AND ($2::int IS NULL OR st.product_id = $2)
        AND ($3::int IS NULL OR st.warehouse_id = $3)
        GROUP BY p.name, w.name
      `;
      const result = await db.query(query, [date, product_id || null, warehouse_id || null]);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new StockLedgerController();
