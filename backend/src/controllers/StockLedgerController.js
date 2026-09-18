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

  // Stock Ledger - a chronological "stock card" plus running balance for the
  // period. product_id/warehouse_id are optional filters: with both given,
  // this is the classic single stock card; with either left as "All", it
  // returns one stock card per (product, warehouse) combination that had
  // activity, each with its own opening/closing balance and running total -
  // a running balance only means anything within one product/warehouse pair,
  // so "All" fans out into multiple cards rather than one blended number.
  getLedger = async (req, res) => {
    const { product_id, warehouse_id, from, to } = req.query;

    try {
      const today = todayUtcIsoDate();
      const fromDate = from || today;
      const toDate = to || today;

      // Each query below starts with a different number of positional date
      // params, so the filter placeholders are numbered per-query (off of
      // that query's own params array) rather than shared - reusing one
      // shared numbering here previously collided product_id/warehouse_id
      // onto the same $N as a date param.
      const buildFilters = (baseParams) => {
        const params = [...baseParams];
        const conditions = [];
        if (product_id) { params.push(product_id); conditions.push(`st.product_id = $${params.length}`); }
        if (warehouse_id) { params.push(warehouse_id); conditions.push(`st.warehouse_id = $${params.length}`); }
        return { params, clause: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '' };
      };

      const openingFilters = buildFilters([fromDate]);
      const openingResult = await db.query(
        `SELECT st.product_id, st.warehouse_id, COALESCE(SUM(st.quantity_change), 0) as opening_balance
         FROM stock_transactions st
         WHERE st.created_at < $1 ${openingFilters.clause}
         GROUP BY st.product_id, st.warehouse_id`,
        openingFilters.params
      );
      const openingBalanceByGroup = new Map(
        openingResult.rows.map((row) => [`${row.product_id}-${row.warehouse_id}`, Number(row.opening_balance)])
      );

      const txFilters = buildFilters([fromDate, `${toDate} 23:59:59`]);
      const transactionsResult = await db.query(
        `SELECT st.id, st.product_id, st.warehouse_id, st.created_at, st.transaction_type, st.quantity_change, st.reference_id,
                p.name as product_name, p.product_code, p.unit, w.name as warehouse_name
         FROM stock_transactions st
         JOIN products p ON st.product_id = p.id
         JOIN warehouses w ON st.warehouse_id = w.id
         WHERE st.created_at >= $1 AND st.created_at <= $2 ${txFilters.clause}
         ORDER BY st.product_id, st.warehouse_id, st.created_at, st.id`,
        txFilters.params
      );

      const groupsByKey = new Map();
      const groupOrder = [];
      for (const row of transactionsResult.rows) {
        const key = `${row.product_id}-${row.warehouse_id}`;
        if (!groupsByKey.has(key)) {
          const openingBalance = openingBalanceByGroup.get(key) || 0;
          groupsByKey.set(key, {
            product_id: row.product_id,
            product_name: row.product_name,
            product_code: row.product_code,
            unit: row.unit,
            warehouse_id: row.warehouse_id,
            warehouse_name: row.warehouse_name,
            opening_balance: openingBalance,
            running_balance: openingBalance,
            entries: [],
          });
          groupOrder.push(key);
        }
        const group = groupsByKey.get(key);
        group.running_balance += Number(row.quantity_change);
        group.entries.push({
          id: row.id,
          created_at: row.created_at,
          transaction_type: row.transaction_type,
          quantity_change: Number(row.quantity_change),
          reference_id: row.reference_id,
          running_balance: group.running_balance,
        });
      }

      const groups = groupOrder.map((key) => {
        const group = groupsByKey.get(key);
        return { ...group, closing_balance: group.running_balance };
      });

      res.json({ from: fromDate, to: toDate, groups });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new StockLedgerController();
