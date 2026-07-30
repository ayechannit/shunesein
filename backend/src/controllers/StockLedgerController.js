const db = require('../config/db');
const { todayUtcIsoDate } = require('../utils/dateUtils');

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

  // Stock Ledger - a chronological "stock card" for one product at one
  // warehouse: every transaction in the period plus a running balance,
  // seeded from whatever the balance already was going into the period.
  getLedger = async (req, res) => {
    const { product_id, warehouse_id, from, to } = req.query;
    if (!product_id || !warehouse_id) {
      return res.status(400).json({ message: 'product_id and warehouse_id are required' });
    }

    try {
      const today = todayUtcIsoDate();
      const fromDate = from || today;
      const toDate = to || today;

      const openingResult = await db.query(
        `SELECT COALESCE(SUM(quantity_change), 0) as opening_balance
         FROM stock_transactions
         WHERE product_id = $1 AND warehouse_id = $2 AND created_at < $3`,
        [product_id, warehouse_id, fromDate]
      );
      const openingBalance = Number(openingResult.rows[0].opening_balance);

      const transactionsResult = await db.query(
        `SELECT id, created_at, transaction_type, quantity_change, reference_id
         FROM stock_transactions
         WHERE product_id = $1 AND warehouse_id = $2 AND created_at >= $3 AND created_at <= $4
         ORDER BY created_at, id`,
        [product_id, warehouse_id, fromDate, `${toDate} 23:59:59`]
      );

      let runningBalance = openingBalance;
      const entries = transactionsResult.rows.map((row) => {
        runningBalance += Number(row.quantity_change);
        return { ...row, quantity_change: Number(row.quantity_change), running_balance: runningBalance };
      });

      res.json({
        from: fromDate,
        to: toDate,
        opening_balance: openingBalance,
        closing_balance: runningBalance,
        entries,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new StockLedgerController();
