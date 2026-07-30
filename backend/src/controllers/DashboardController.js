const db = require('../config/db');
const { monthBuckets } = require('../utils/dateUtils');

const MONTHS_BACK = 5; // 6 months total including the current month

class DashboardController {
  // The shared post-login landing page - every authenticated user can see it
  // (see miscRoutes.js), regardless of their granular module permissions,
  // since it's all aggregate figures rather than record-level detail.
  getDashboardStats = async (req, res) => {
    try {
      const [
        todaySales,
        todayPurchases,
        todayProduction,
        pendingOrders,
        accounts,
        supplierOutstanding,
        customerOutstanding,
        lowStockItems,
        lowStockCount,
        bestSellers,
        monthlySales,
        monthlyExpenses,
        customerAging,
        supplierAging,
        stockByCategory,
        monthlyCashIn,
        monthlyCashOut,
      ] = await Promise.all([
        // Net of tax collected (a liability, not income) - see ReportController's
        // Sales Summary/P&L for the same convention. Purchases stay net_amount
        // (total payable including tax), since that figure is about cash owed, not revenue.
        db.query(`SELECT COALESCE(SUM(total_amount - discount_amount), 0) AS total FROM sales_invoices WHERE invoice_date = CURRENT_DATE`),
        db.query(`SELECT COALESCE(SUM(net_amount), 0) AS total FROM purchase_vouchers WHERE voucher_date = CURRENT_DATE`),
        db.query(`
          SELECT COALESCE(SUM(pfg.quantity), 0) AS total
          FROM production_finished_goods pfg
          JOIN production_batches pb ON pfg.batch_id = pb.id
          WHERE pb.status = 'completed' AND DATE(pb.end_date) = CURRENT_DATE
        `),
        db.query(`SELECT COUNT(*) AS total FROM purchase_orders WHERE status = 'pending'`),
        db.query(`SELECT id, name, account_type, balance FROM accounts ORDER BY name`),
        db.query(`SELECT COALESCE(SUM(outstanding_balance), 0) AS total FROM suppliers`),
        db.query(`SELECT COALESCE(SUM(outstanding_balance), 0) AS total FROM customers`),
        db.query(`
          SELECT p.id AS product_id, p.name AS product_name, w.name AS warehouse_name, sl.quantity, p.min_stock_level
          FROM stock_levels sl
          JOIN products p ON sl.product_id = p.id
          JOIN warehouses w ON sl.warehouse_id = w.id
          WHERE p.min_stock_level > 0 AND sl.quantity <= p.min_stock_level
          ORDER BY (p.min_stock_level - sl.quantity) DESC
          LIMIT 10
        `),
        db.query(`
          SELECT COUNT(*) AS total
          FROM stock_levels sl
          JOIN products p ON sl.product_id = p.id
          WHERE p.min_stock_level > 0 AND sl.quantity <= p.min_stock_level
        `),
        db.query(`
          SELECT p.id AS product_id, p.name AS product_name,
                 SUM(si.quantity) AS total_quantity, SUM(si.subtotal) AS total_revenue
          FROM sales_items si
          JOIN sales_invoices inv ON si.invoice_id = inv.id
          JOIN products p ON si.product_id = p.id
          WHERE inv.invoice_date >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY p.id, p.name
          ORDER BY total_quantity DESC
          LIMIT 5
        `),
        db.query(`
          SELECT TO_CHAR(invoice_date, 'YYYY-MM') AS month, SUM(total_amount - discount_amount) AS total
          FROM sales_invoices
          WHERE invoice_date >= date_trunc('month', CURRENT_DATE - INTERVAL '${MONTHS_BACK} months')
          GROUP BY month
        `),
        db.query(`
          SELECT TO_CHAR(e.date, 'YYYY-MM') AS month, SUM(e.amount) AS total
          FROM income_expense_entries e
          JOIN income_expense_categories c ON e.category_id = c.id
          WHERE c.type = 'expense' AND e.date >= date_trunc('month', CURRENT_DATE - INTERVAL '${MONTHS_BACK} months')
          GROUP BY month
        `),
        // AR aging buckets - same logic as ReportController.getOutstanding,
        // condensed to just the bucket totals the dashboard chart needs.
        db.query(`
          WITH unpaid AS (
            SELECT inv.net_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE transaction_type = 'sale' AND transaction_id = inv.id), 0) AS outstanding,
                   (CURRENT_DATE - inv.invoice_date) AS age_days
            FROM sales_invoices inv WHERE inv.payment_status != 'paid'
          )
          SELECT
            COALESCE(SUM(CASE WHEN age_days <= 30 THEN outstanding ELSE 0 END), 0) AS current_0_30,
            COALESCE(SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN outstanding ELSE 0 END), 0) AS days_31_60,
            COALESCE(SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN outstanding ELSE 0 END), 0) AS days_61_90,
            COALESCE(SUM(CASE WHEN age_days > 90 THEN outstanding ELSE 0 END), 0) AS days_over_90
          FROM unpaid WHERE outstanding > 0.01
        `),
        db.query(`
          WITH unpaid AS (
            SELECT pv.net_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE transaction_type = 'purchase' AND transaction_id = pv.id), 0) AS outstanding,
                   (CURRENT_DATE - pv.voucher_date) AS age_days
            FROM purchase_vouchers pv WHERE pv.payment_status != 'paid'
          )
          SELECT
            COALESCE(SUM(CASE WHEN age_days <= 30 THEN outstanding ELSE 0 END), 0) AS current_0_30,
            COALESCE(SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN outstanding ELSE 0 END), 0) AS days_31_60,
            COALESCE(SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN outstanding ELSE 0 END), 0) AS days_61_90,
            COALESCE(SUM(CASE WHEN age_days > 90 THEN outstanding ELSE 0 END), 0) AS days_over_90
          FROM unpaid WHERE outstanding > 0.01
        `),
        db.query(`
          SELECT COALESCE(c.name, 'Uncategorized') AS category_name, SUM(sl.quantity * p.cost_price) AS total_value
          FROM stock_levels sl
          JOIN products p ON sl.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          GROUP BY category_name
          ORDER BY total_value DESC
          LIMIT 8
        `),
        // Cash-basis inflow, mirroring ReportController.getCashFlowStatement -
        // when cash actually moved (payment date), not when it was invoiced.
        db.query(`
          SELECT TO_CHAR(p.payment_date, 'YYYY-MM') AS month, SUM(p.amount) AS total
          FROM payments p JOIN sales_invoices inv ON p.transaction_id = inv.id
          WHERE p.transaction_type = 'sale' AND p.payment_date >= date_trunc('month', CURRENT_DATE - INTERVAL '${MONTHS_BACK} months')
          GROUP BY month
        `),
        db.query(`
          SELECT TO_CHAR(p.payment_date, 'YYYY-MM') AS month, SUM(p.amount) AS total
          FROM payments p JOIN purchase_vouchers pv ON p.transaction_id = pv.id
          WHERE p.transaction_type = 'purchase' AND p.payment_date >= date_trunc('month', CURRENT_DATE - INTERVAL '${MONTHS_BACK} months')
          GROUP BY month
        `),
      ]);

      const salesByMonth = new Map(monthlySales.rows.map((row) => [row.month, Number(row.total)]));
      const expensesByMonth = new Map(monthlyExpenses.rows.map((row) => [row.month, Number(row.total)]));
      const cashInByMonth = new Map(monthlyCashIn.rows.map((row) => [row.month, Number(row.total)]));
      const cashOutByMonth = new Map(monthlyCashOut.rows.map((row) => [row.month, Number(row.total)]));

      const monthlyChart = [];
      for (const key of monthBuckets(MONTHS_BACK)) {
        const cashIn = cashInByMonth.get(key) || 0;
        const cashOut = cashOutByMonth.get(key) || 0;
        monthlyChart.push({
          month: key,
          sales: salesByMonth.get(key) || 0,
          expenses: expensesByMonth.get(key) || 0,
          cash_in: cashIn,
          cash_out: cashOut,
          net_cash_flow: cashIn - cashOut,
        });
      }

      const agingRow = (result) => ({
        current_0_30: Number(result.rows[0].current_0_30),
        days_31_60: Number(result.rows[0].days_31_60),
        days_61_90: Number(result.rows[0].days_61_90),
        days_over_90: Number(result.rows[0].days_over_90),
      });

      res.json({
        today: {
          sales: Number(todaySales.rows[0].total),
          purchases: Number(todayPurchases.rows[0].total),
          production_output: Number(todayProduction.rows[0].total),
        },
        pending_purchase_orders: parseInt(pendingOrders.rows[0].total, 10),
        accounts: {
          total_balance: accounts.rows.reduce((sum, account) => sum + Number(account.balance), 0),
          items: accounts.rows,
        },
        outstanding: {
          supplier_total: Number(supplierOutstanding.rows[0].total),
          customer_total: Number(customerOutstanding.rows[0].total),
        },
        aging: {
          customer: agingRow(customerAging),
          supplier: agingRow(supplierAging),
        },
        low_stock: {
          count: parseInt(lowStockCount.rows[0].total, 10),
          items: lowStockItems.rows,
        },
        stock_by_category: stockByCategory.rows.map((row) => ({ category_name: row.category_name, total_value: Number(row.total_value) })),
        best_selling_products: bestSellers.rows.map((row) => ({
          ...row,
          total_quantity: Number(row.total_quantity),
          total_revenue: Number(row.total_revenue),
        })),
        monthly_chart: monthlyChart,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new DashboardController();
