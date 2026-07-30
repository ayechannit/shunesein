const db = require('../config/db');
const { todayUtcIsoDate, resolveDateRange, resolvePreviousRange } = require('../utils/dateUtils');

const ALLOWED_MOVEMENT_SORT = ['created_at', 'transaction_type', 'quantity_change'];
const AGING_BUCKETS_SQL = `
  SUM(CASE WHEN age_days <= 30 THEN outstanding ELSE 0 END) AS current_0_30,
  SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN outstanding ELSE 0 END) AS days_31_60,
  SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN outstanding ELSE 0 END) AS days_61_90,
  SUM(CASE WHEN age_days > 90 THEN outstanding ELSE 0 END) AS days_over_90,
  SUM(outstanding) AS total_outstanding
`;

const toNumber = (value) => Number(value || 0);
const toInt = (value) => parseInt(value || 0, 10);

const percentChange = (current, previous) => {
  if (!previous) return current ? (current > 0 ? 100 : -100) : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
};

// Shared by getProfitLoss for both the requested period and, when
// ?compare=true, the immediately preceding period of equal length.
const computeProfitLossSummary = async (from, to) => {
  const [salesResult, cogsResult, expenseByCategoryResult, otherIncomeResult] = await Promise.all([
    db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as gross_sales,
              COALESCE(SUM(discount_amount), 0) as sales_discounts,
              COALESCE(SUM(tax_amount), 0) as sales_tax_collected
       FROM sales_invoices WHERE invoice_date BETWEEN $1 AND $2`,
      [from, to]
    ),
    db.query(
      `SELECT COALESCE(SUM(si.quantity * p.cost_price), 0) as total
       FROM sales_items si
       JOIN sales_invoices inv ON si.invoice_id = inv.id
       JOIN products p ON si.product_id = p.id
       WHERE inv.invoice_date BETWEEN $1 AND $2`,
      [from, to]
    ),
    db.query(
      `SELECT c.name as category_name, COALESCE(SUM(e.amount), 0) as total
       FROM income_expense_entries e JOIN income_expense_categories c ON e.category_id = c.id
       WHERE c.type = 'expense' AND e.date BETWEEN $1 AND $2
       GROUP BY c.name
       ORDER BY total DESC`,
      [from, to]
    ),
    db.query(
      `SELECT COALESCE(SUM(e.amount), 0) as total
       FROM income_expense_entries e JOIN income_expense_categories c ON e.category_id = c.id
       WHERE c.type = 'income' AND e.date BETWEEN $1 AND $2`,
      [from, to]
    ),
  ]);

  const salesRow = salesResult.rows[0];
  const grossSales = toNumber(salesRow.gross_sales);
  const salesDiscounts = toNumber(salesRow.sales_discounts);
  const salesTaxCollected = toNumber(salesRow.sales_tax_collected);
  const netSales = grossSales - salesDiscounts;

  const cogs = toNumber(cogsResult.rows[0].total);
  const grossProfit = netSales - cogs;
  const grossMarginPercent = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

  const operatingExpensesByCategory = expenseByCategoryResult.rows.map((row) => ({ category_name: row.category_name, amount: toNumber(row.total) }));
  const totalOperatingExpenses = operatingExpensesByCategory.reduce((sum, row) => sum + row.amount, 0);
  const operatingProfit = grossProfit - totalOperatingExpenses;

  const otherIncome = toNumber(otherIncomeResult.rows[0].total);
  const netProfit = operatingProfit + otherIncome;
  const netMarginPercent = netSales > 0 ? (netProfit / netSales) * 100 : 0;

  return {
    from,
    to,
    gross_sales: grossSales,
    sales_discounts: salesDiscounts,
    net_sales: netSales,
    sales_tax_collected: salesTaxCollected,
    cogs,
    gross_profit: grossProfit,
    gross_margin_percent: grossMarginPercent,
    operating_expenses_by_category: operatingExpensesByCategory,
    total_operating_expenses: totalOperatingExpenses,
    operating_profit: operatingProfit,
    other_income: otherIncome,
    net_profit: netProfit,
    net_margin_percent: netMarginPercent,
  };
};

// Lightweight comparison helpers for ?compare=true - just the top-line
// figures worth comparing period-over-period, not the full by_product/
// by_customer/by_supplier breakdown (re-running that for a second period
// the user didn't ask to see in detail would be wasted work).
const computeSalesTotalsOnly = async (from, to) => {
  const [totals, costResult] = await Promise.all([
    db.query(
      `SELECT COUNT(*) as invoice_count, COALESCE(SUM(total_amount - discount_amount), 0) as net_sales
       FROM sales_invoices WHERE invoice_date BETWEEN $1 AND $2`,
      [from, to]
    ),
    db.query(
      `SELECT COALESCE(SUM(si.quantity * p.cost_price), 0) as total_cost
       FROM sales_items si
       JOIN sales_invoices inv ON si.invoice_id = inv.id
       JOIN products p ON si.product_id = p.id
       WHERE inv.invoice_date BETWEEN $1 AND $2`,
      [from, to]
    ),
  ]);
  const t = totals.rows[0];
  const netSales = toNumber(t.net_sales);
  return { invoice_count: toInt(t.invoice_count), net_sales: netSales, gross_margin: netSales - toNumber(costResult.rows[0].total_cost) };
};

const computePurchaseTotalsOnly = async (from, to) => {
  const result = await db.query(
    `SELECT COUNT(*) as voucher_count, COALESCE(SUM(net_amount), 0) as net_amount
     FROM purchase_vouchers WHERE voucher_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const row = result.rows[0];
  return { voucher_count: toInt(row.voucher_count), net_amount: toNumber(row.net_amount) };
};

class ReportController {
  // Current Stock Report - quantity AND inventory value (qty x cost price).
  // Quantity alone doesn't tell an accountant what's tied up in inventory,
  // which is what actually matters for the balance sheet and for prioritizing
  // what to review.
  getCurrentStock = async (req, res) => {
    try {
      const { warehouse_id } = req.query;
      const whereClause = warehouse_id ? 'WHERE sl.warehouse_id = $1' : '';
      const params = warehouse_id ? [warehouse_id] : [];
      const query = `
        SELECT p.name as product_name, p.product_code, w.name as warehouse_name,
               sl.quantity, p.cost_price, (sl.quantity * p.cost_price) as stock_value
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        JOIN warehouses w ON sl.warehouse_id = w.id
        ${whereClause}
        ORDER BY w.name, p.name
      `;
      const result = await db.query(query, params);
      const items = result.rows.map((row) => ({ ...row, cost_price: toNumber(row.cost_price), stock_value: toNumber(row.stock_value) }));
      res.json({
        items,
        total_value: items.reduce((sum, row) => sum + row.stock_value, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Low Stock Report - includes the estimated cost to restock every
  // shortfall to its minimum level, so this doubles as a reorder budget.
  getLowStock = async (req, res) => {
    try {
      const query = `
        SELECT p.name as product_name, p.min_stock_level, w.name as warehouse_name, sl.quantity,
               p.cost_price, (p.min_stock_level - sl.quantity) as shortfall,
               ((p.min_stock_level - sl.quantity) * p.cost_price) as reorder_value
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        JOIN warehouses w ON sl.warehouse_id = w.id
        WHERE p.min_stock_level > 0 AND sl.quantity <= p.min_stock_level
        ORDER BY (p.min_stock_level - sl.quantity) DESC
      `;
      const result = await db.query(query);
      const items = result.rows.map((row) => ({
        ...row,
        cost_price: toNumber(row.cost_price),
        shortfall: toNumber(row.shortfall),
        reorder_value: toNumber(row.reorder_value),
      }));
      res.json({ items, total_reorder_value: items.reduce((sum, row) => sum + row.reorder_value, 0) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Stock Movement Report - every raw in/out transaction, filterable, paginated.
  // Distinct from the Stock Ledger, which computes a running balance for one
  // product/warehouse; this is the broader audit trail across everything.
  // value_change (qty x current cost) turns "the quantity moved" into "what
  // that movement was worth" - important for spotting costly write-offs/adjustments.
  getStockMovement = async (req, res) => {
    try {
      let { page = 1, limit = 20, product_id, warehouse_id, transaction_type, from, to, sortBy = 'created_at', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      const safeSortBy = ALLOWED_MOVEMENT_SORT.includes(sortBy) ? sortBy : 'created_at';
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const conditions = [];
      const params = [];
      if (product_id) { params.push(product_id); conditions.push(`st.product_id = $${params.length}`); }
      if (warehouse_id) { params.push(warehouse_id); conditions.push(`st.warehouse_id = $${params.length}`); }
      if (transaction_type) { params.push(transaction_type); conditions.push(`st.transaction_type = $${params.length}`); }
      if (from) { params.push(from); conditions.push(`st.created_at >= $${params.length}`); }
      if (to) { params.push(`${to} 23:59:59`); conditions.push(`st.created_at <= $${params.length}`); }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // reference_id alone ("#42") doesn't say what document it points to -
      // which table it references depends on transaction_type, so each
      // candidate source is joined conditionally and COALESCEd into one
      // human-readable reference_number (e.g. the actual voucher/invoice number).
      const dataQuery = `
        SELECT st.*, p.name as product_name, p.product_code, w.name as warehouse_name,
               p.cost_price, (st.quantity_change * p.cost_price) as value_change,
               COALESCE(pvo.voucher_number, si2.invoice_number, sf.transfer_number, sa.adjustment_number, pb2.batch_number) as reference_number
        FROM stock_transactions st
        JOIN products p ON st.product_id = p.id
        JOIN warehouses w ON st.warehouse_id = w.id
        LEFT JOIN purchase_vouchers pvo ON st.transaction_type = 'purchase' AND st.reference_id = pvo.id
        LEFT JOIN sales_invoices si2 ON st.transaction_type = 'sale' AND st.reference_id = si2.id
        LEFT JOIN stock_transfers sf ON st.transaction_type IN ('transfer_in', 'transfer_out') AND st.reference_id = sf.id
        LEFT JOIN stock_adjustments sa ON st.transaction_type = 'adjustment' AND st.reference_id = sa.id
        LEFT JOIN production_batches pb2 ON st.transaction_type IN ('production', 'production_reversal') AND st.reference_id = pb2.id
        ${whereClause}
        ORDER BY st.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM stock_transactions st ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      const data = dataResult.rows.map((row) => ({ ...row, cost_price: toNumber(row.cost_price), value_change: toNumber(row.value_change) }));
      res.json({ data, total: toInt(countResult.rows[0].count), page: toInt(page), limit: toInt(limit) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Purchase Summary Report - a gross-to-net waterfall (discounts and tax
  // paid are shown, not just buried in "the total"), plus breakdowns by
  // supplier AND by product (a purchasing/costing decision needs to know
  // what was bought, not only who from).
  getPurchaseSummary = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);

      const [totals, bySupplier, byProduct] = await Promise.all([
        db.query(
          `SELECT COUNT(*) as voucher_count,
                  COALESCE(SUM(total_amount), 0) as gross_amount,
                  COALESCE(SUM(discount_amount), 0) as purchase_discounts,
                  COALESCE(SUM(tax_amount), 0) as purchase_tax,
                  COALESCE(SUM(net_amount), 0) as net_amount
           FROM purchase_vouchers WHERE voucher_date BETWEEN $1 AND $2`,
          [from, to]
        ),
        db.query(
          `SELECT s.id as supplier_id, s.name as supplier_name,
                  COUNT(pv.id) as voucher_count, COALESCE(SUM(pv.net_amount), 0) as total_amount
           FROM purchase_vouchers pv
           JOIN suppliers s ON pv.supplier_id = s.id
           WHERE pv.voucher_date BETWEEN $1 AND $2
           GROUP BY s.id, s.name
           ORDER BY total_amount DESC`,
          [from, to]
        ),
        db.query(
          `SELECT p.id as product_id, p.name as product_name,
                  SUM(pi.quantity) as total_quantity, SUM(pi.subtotal) as total_cost
           FROM purchase_items pi
           JOIN purchase_vouchers pv ON pi.voucher_id = pv.id
           JOIN products p ON pi.product_id = p.id
           WHERE pv.voucher_date BETWEEN $1 AND $2
           GROUP BY p.id, p.name
           ORDER BY total_cost DESC`,
          [from, to]
        ),
      ]);

      const t = totals.rows[0];
      const voucherCount = toInt(t.voucher_count);
      const netAmount = toNumber(t.net_amount);

      let previous = null;
      if (req.query.compare === 'true') {
        const prevRange = resolvePreviousRange(from, to);
        previous = { ...(await computePurchaseTotalsOnly(prevRange.from, prevRange.to)), from: prevRange.from, to: prevRange.to };
      }

      res.json({
        from,
        to,
        voucher_count: voucherCount,
        gross_amount: toNumber(t.gross_amount),
        purchase_discounts: toNumber(t.purchase_discounts),
        purchase_tax: toNumber(t.purchase_tax),
        net_amount: netAmount,
        average_voucher_value: voucherCount > 0 ? netAmount / voucherCount : 0,
        by_supplier: bySupplier.rows.map((row) => ({ ...row, voucher_count: toInt(row.voucher_count), total_amount: toNumber(row.total_amount) })),
        by_product: byProduct.rows.map((row) => ({ ...row, total_quantity: toNumber(row.total_quantity), total_cost: toNumber(row.total_cost) })),
        previous,
        change: previous ? { net_amount_percent: percentChange(netAmount, previous.net_amount) } : null,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Daily/Monthly Production Report - output valued at each finished good's
  // ACTUAL batch cost (production_finished_goods.unit_cost, captured at
  // production time), falling back to the product's current cost price only
  // for older rows produced before unit_cost was captured. Also compares
  // that output value against the batch's actual raw-material input cost
  // (production_raw_materials.unit_cost) for a real yield/margin figure -
  // both were already captured by the production workflow but never surfaced
  // in a report.
  getProductionSummary = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const groupBy = req.query.groupBy === 'month' ? 'month' : 'day';
      const dateFormat = groupBy === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';

      const [batches, output, input] = await Promise.all([
        db.query(
          `SELECT TO_CHAR(pb.start_date, '${dateFormat}') as period,
                  COUNT(*) as batch_count,
                  COUNT(*) FILTER (WHERE pb.status = 'completed') as completed_count,
                  COUNT(*) FILTER (WHERE pb.status = 'cancelled') as cancelled_count
           FROM production_batches pb
           WHERE pb.start_date BETWEEN $1 AND $2
           GROUP BY period
           ORDER BY period`,
          [from, `${to} 23:59:59`]
        ),
        db.query(
          `SELECT TO_CHAR(pb.end_date, '${dateFormat}') as period,
                  p.id as product_id, p.name as product_name, SUM(pfg.quantity) as total_quantity,
                  SUM(pfg.quantity * COALESCE(pfg.unit_cost, p.cost_price)) as estimated_value
           FROM production_finished_goods pfg
           JOIN production_batches pb ON pfg.batch_id = pb.id
           JOIN products p ON pfg.product_id = p.id
           WHERE pb.status = 'completed' AND pb.end_date BETWEEN $1 AND $2
           GROUP BY period, p.id, p.name
           ORDER BY period, total_quantity DESC`,
          [from, `${to} 23:59:59`]
        ),
        db.query(
          `SELECT TO_CHAR(pb.end_date, '${dateFormat}') as period,
                  SUM(prm.quantity * COALESCE(prm.unit_cost, 0)) as input_cost
           FROM production_raw_materials prm
           JOIN production_batches pb ON prm.batch_id = pb.id
           WHERE pb.status = 'completed' AND pb.end_date BETWEEN $1 AND $2
           GROUP BY period
           ORDER BY period`,
          [from, `${to} 23:59:59`]
        ),
      ]);

      const outputByProduct = output.rows.map((row) => ({
        ...row,
        total_quantity: toNumber(row.total_quantity),
        estimated_value: toNumber(row.estimated_value),
      }));

      const outputValueByPeriod = new Map();
      outputByProduct.forEach((row) => {
        outputValueByPeriod.set(row.period, (outputValueByPeriod.get(row.period) || 0) + row.estimated_value);
      });
      const inputCostByPeriod = new Map(input.rows.map((row) => [row.period, toNumber(row.input_cost)]));
      const allPeriods = Array.from(new Set([...outputValueByPeriod.keys(), ...inputCostByPeriod.keys()])).sort();

      const yieldByPeriod = allPeriods.map((period) => {
        const outputValue = outputValueByPeriod.get(period) || 0;
        const inputCost = inputCostByPeriod.get(period) || 0;
        const variance = outputValue - inputCost;
        return {
          period,
          input_cost: inputCost,
          output_value: outputValue,
          variance,
          yield_percent: inputCost > 0 ? (outputValue / inputCost) * 100 : 0,
        };
      });

      res.json({
        from,
        to,
        group_by: groupBy,
        batches: batches.rows.map((row) => ({
          period: row.period,
          batch_count: toInt(row.batch_count),
          completed_count: toInt(row.completed_count),
          cancelled_count: toInt(row.cancelled_count),
        })),
        output_by_product: outputByProduct,
        total_output_value: outputByProduct.reduce((sum, row) => sum + row.estimated_value, 0),
        yield_by_period: yieldByPeriod,
        total_input_cost: yieldByPeriod.reduce((sum, row) => sum + row.input_cost, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Sales Summary Report - a gross-to-net waterfall plus breakdowns by
  // product and by customer. Net Sales (Revenue) excludes tax collected -
  // sales tax is money held for the tax authority, not income, so it's
  // reported separately rather than folded into "sales."
  getSalesSummary = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.startDate || req.query.from, req.query.endDate || req.query.to);

      const [totals, byProduct, byCustomer, byCustomerCost] = await Promise.all([
        db.query(
          `SELECT COUNT(*) as invoice_count,
                  COALESCE(SUM(total_amount), 0) as gross_sales,
                  COALESCE(SUM(discount_amount), 0) as sales_discounts,
                  COALESCE(SUM(tax_amount), 0) as sales_tax_collected,
                  COALESCE(SUM(total_amount - discount_amount), 0) as net_sales
           FROM sales_invoices WHERE invoice_date BETWEEN $1 AND $2`,
          [from, to]
        ),
        db.query(
          `SELECT p.id as product_id, p.name as product_name,
                  SUM(si.quantity) as total_quantity, SUM(si.subtotal) as total_revenue,
                  SUM(si.quantity * p.cost_price) as total_cost
           FROM sales_items si
           JOIN sales_invoices inv ON si.invoice_id = inv.id
           JOIN products p ON si.product_id = p.id
           WHERE inv.invoice_date BETWEEN $1 AND $2
           GROUP BY p.id, p.name
           ORDER BY total_revenue DESC`,
          [from, to]
        ),
        db.query(
          `SELECT c.id as customer_id, c.name as customer_name,
                  COUNT(inv.id) as invoice_count, COALESCE(SUM(inv.total_amount - inv.discount_amount), 0) as total_amount
           FROM sales_invoices inv
           JOIN customers c ON inv.customer_id = c.id
           WHERE inv.invoice_date BETWEEN $1 AND $2
           GROUP BY c.id, c.name
           ORDER BY total_amount DESC`,
          [from, to]
        ),
        // Cost per customer, computed separately from by_customer above -
        // joining sales_items into that invoice-level aggregation would fan
        // out and corrupt the SUM(total_amount) figures.
        db.query(
          `SELECT inv.customer_id, SUM(si.quantity * p.cost_price) as total_cost
           FROM sales_items si
           JOIN sales_invoices inv ON si.invoice_id = inv.id
           JOIN products p ON si.product_id = p.id
           WHERE inv.invoice_date BETWEEN $1 AND $2
           GROUP BY inv.customer_id`,
          [from, to]
        ),
      ]);

      const t = totals.rows[0];
      const invoiceCount = toInt(t.invoice_count);
      const netSales = toNumber(t.net_sales);

      const byProductRows = byProduct.rows.map((row) => {
        const totalRevenue = toNumber(row.total_revenue);
        const totalCost = toNumber(row.total_cost);
        const margin = totalRevenue - totalCost;
        return {
          ...row,
          total_quantity: toNumber(row.total_quantity),
          total_revenue: totalRevenue,
          total_cost: totalCost,
          margin,
          margin_percent: totalRevenue > 0 ? (margin / totalRevenue) * 100 : 0,
        };
      });

      const costByCustomer = new Map(byCustomerCost.rows.map((row) => [row.customer_id, toNumber(row.total_cost)]));
      const byCustomerRows = byCustomer.rows.map((row) => {
        const totalAmount = toNumber(row.total_amount);
        const totalCost = costByCustomer.get(row.customer_id) || 0;
        const margin = totalAmount - totalCost;
        return {
          ...row,
          invoice_count: toInt(row.invoice_count),
          total_amount: totalAmount,
          total_cost: totalCost,
          margin,
          margin_percent: totalAmount > 0 ? (margin / totalAmount) * 100 : 0,
        };
      });

      const totalCost = byProductRows.reduce((sum, row) => sum + row.total_cost, 0);
      const grossMargin = netSales - totalCost;

      let previous = null;
      if (req.query.compare === 'true') {
        const prevRange = resolvePreviousRange(from, to);
        previous = { ...(await computeSalesTotalsOnly(prevRange.from, prevRange.to)), from: prevRange.from, to: prevRange.to };
      }

      res.json({
        from,
        to,
        invoice_count: invoiceCount,
        gross_sales: toNumber(t.gross_sales),
        sales_discounts: toNumber(t.sales_discounts),
        sales_tax_collected: toNumber(t.sales_tax_collected),
        net_sales: netSales,
        average_invoice_value: invoiceCount > 0 ? netSales / invoiceCount : 0,
        // Cost/margin approximated from each product's CURRENT cost price -
        // same convention and same caveat as the P&L's COGS figure.
        total_cost: totalCost,
        gross_margin: grossMargin,
        gross_margin_percent: netSales > 0 ? (grossMargin / netSales) * 100 : 0,
        by_product: byProductRows,
        by_customer: byCustomerRows,
        previous,
        change: previous
          ? { net_sales_percent: percentChange(netSales, previous.net_sales), gross_margin_percent_change: percentChange(grossMargin, previous.gross_margin) }
          : null,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Customer/Supplier Outstanding Report - a proper Accounts Receivable /
  // Accounts Payable aging report (0-30 / 31-60 / 61-90 / 90+ days), not
  // just a flat balance. Aged from each unpaid invoice/voucher's own date,
  // computed from net_amount less payments actually received/made - not
  // read off the payment_status flag, which is a convenience label that can
  // lag reality, whereas this is always correct by construction.
  getOutstanding = async (req, res) => {
    try {
      const [customers, suppliers, customerTotals, supplierTotals] = await Promise.all([
        db.query(
          `WITH unpaid AS (
             SELECT inv.id, inv.customer_id, inv.invoice_date,
                    inv.net_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE transaction_type = 'sale' AND transaction_id = inv.id), 0) as outstanding,
                    (CURRENT_DATE - inv.invoice_date) as age_days
             FROM sales_invoices inv
             WHERE inv.payment_status != 'paid'
           )
           SELECT c.id as customer_id, c.name as customer_name, c.customer_type, c.credit_limit,
                  ${AGING_BUCKETS_SQL}
           FROM unpaid u
           JOIN customers c ON c.id = u.customer_id
           WHERE u.outstanding > 0.01
           GROUP BY c.id, c.name, c.customer_type, c.credit_limit
           ORDER BY total_outstanding DESC`
        ),
        db.query(
          `WITH unpaid AS (
             SELECT pv.id, pv.supplier_id, pv.voucher_date,
                    pv.net_amount - COALESCE((SELECT SUM(amount) FROM payments WHERE transaction_type = 'purchase' AND transaction_id = pv.id), 0) as outstanding,
                    (CURRENT_DATE - pv.voucher_date) as age_days
             FROM purchase_vouchers pv
             WHERE pv.payment_status != 'paid'
           )
           SELECT s.id as supplier_id, s.name as supplier_name,
                  ${AGING_BUCKETS_SQL}
           FROM unpaid u
           JOIN suppliers s ON s.id = u.supplier_id
           WHERE u.outstanding > 0.01
           GROUP BY s.id, s.name
           ORDER BY total_outstanding DESC`
        ),
        db.query(`SELECT COALESCE(SUM(outstanding_balance), 0) as total FROM customers`),
        db.query(`SELECT COALESCE(SUM(outstanding_balance), 0) as total FROM suppliers`),
      ]);

      const mapAging = (row) => ({
        ...row,
        current_0_30: toNumber(row.current_0_30),
        days_31_60: toNumber(row.days_31_60),
        days_61_90: toNumber(row.days_61_90),
        days_over_90: toNumber(row.days_over_90),
        total_outstanding: toNumber(row.total_outstanding),
      });

      const customerItems = customers.rows.map(mapAging);
      const supplierItems = suppliers.rows.map(mapAging);

      const sumBucket = (items, key) => items.reduce((sum, row) => sum + row[key], 0);
      // Cross-checks the aging report (built from unpaid invoices/vouchers)
      // against the master record's own outstanding_balance column (kept up
      // to date by the payment workflows). These should always tie out - if
      // they don't, that's a data-integrity issue worth investigating (e.g.
      // a payment that updated the balance without being correctly linked to
      // its invoice/voucher), not something this report should silently hide.
      const round2 = (value) => Math.round(value * 100) / 100;

      const buildSection = (items, recordedTotal) => {
        const agedTotal = round2(sumBucket(items, 'total_outstanding'));
        return {
          total: recordedTotal,
          aging_summary: {
            current_0_30: sumBucket(items, 'current_0_30'),
            days_31_60: sumBucket(items, 'days_31_60'),
            days_61_90: sumBucket(items, 'days_61_90'),
            days_over_90: sumBucket(items, 'days_over_90'),
          },
          aged_total: agedTotal,
          reconciles: Math.abs(agedTotal - round2(recordedTotal)) < 0.01,
          items,
        };
      };

      res.json({
        customers: buildSection(customerItems, toNumber(customerTotals.rows[0].total)),
        suppliers: buildSection(supplierItems, toNumber(supplierTotals.rows[0].total)),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Profit & Loss Report - a standard multi-step statement: Net Sales, COGS,
  // Gross Profit (+ margin %), Operating Expenses by category, Operating
  // Profit, Other Income, Net Profit (+ margin %).
  //
  // Net Sales excludes sales tax collected (a liability, not income - see
  // getSalesSummary). COGS is approximated as (quantity sold x each
  // product's CURRENT cost_price) rather than "purchases in the period" -
  // that's raw material spend, not the cost of what was actually sold. This
  // system has no automated recipe/BOM costing (per the original scope), so
  // a precise historical unit cost per sale isn't tracked - cost_price is
  // the best available approximation without that costing layer.
  getProfitLoss = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.startDate || req.query.from, req.query.endDate || req.query.to);
      const current = await computeProfitLossSummary(from, to);

      let previous = null;
      if (req.query.compare === 'true') {
        const prevRange = resolvePreviousRange(from, to);
        previous = await computeProfitLossSummary(prevRange.from, prevRange.to);
      }

      res.json({
        ...current,
        previous,
        change: previous
          ? {
              net_sales_percent: percentChange(current.net_sales, previous.net_sales),
              gross_profit_percent: percentChange(current.gross_profit, previous.gross_profit),
              net_profit_percent: percentChange(current.net_profit, previous.net_profit),
            }
          : null,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Tax/VAT Summary - tax collected on sales vs. tax paid on purchases, both
  // already captured on every voucher/invoice (tax_amount) but never
  // reported together. Net tax payable is what's owed to the tax authority
  // for the period (negative means net reclaimable). Monthly breakdown
  // included since filing is normally done period by period, not as one lump sum.
  getTaxSummary = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);

      const [totals, byMonth] = await Promise.all([
        db.query(
          `SELECT
             COALESCE((SELECT SUM(tax_amount) FROM sales_invoices WHERE invoice_date BETWEEN $1 AND $2), 0) AS sales_tax_collected,
             COALESCE((SELECT SUM(tax_amount) FROM purchase_vouchers WHERE voucher_date BETWEEN $1 AND $2), 0) AS purchase_tax_paid`,
          [from, to]
        ),
        db.query(
          `SELECT period, SUM(sales_tax_collected) AS sales_tax_collected, SUM(purchase_tax_paid) AS purchase_tax_paid
           FROM (
             SELECT TO_CHAR(invoice_date, 'YYYY-MM') AS period, tax_amount AS sales_tax_collected, 0 AS purchase_tax_paid
             FROM sales_invoices WHERE invoice_date BETWEEN $1 AND $2
             UNION ALL
             SELECT TO_CHAR(voucher_date, 'YYYY-MM') AS period, 0 AS sales_tax_collected, tax_amount AS purchase_tax_paid
             FROM purchase_vouchers WHERE voucher_date BETWEEN $1 AND $2
           ) combined
           GROUP BY period
           ORDER BY period`,
          [from, to]
        ),
      ]);

      const t = totals.rows[0];
      const salesTaxCollected = toNumber(t.sales_tax_collected);
      const purchaseTaxPaid = toNumber(t.purchase_tax_paid);

      res.json({
        from,
        to,
        sales_tax_collected: salesTaxCollected,
        purchase_tax_paid: purchaseTaxPaid,
        net_tax_payable: salesTaxCollected - purchaseTaxPaid,
        by_month: byMonth.rows.map((row) => ({
          period: row.period,
          sales_tax_collected: toNumber(row.sales_tax_collected),
          purchase_tax_paid: toNumber(row.purchase_tax_paid),
          net_tax_payable: toNumber(row.sales_tax_collected) - toNumber(row.purchase_tax_paid),
        })),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Expense Report - a standalone, filterable view over every income/expense
  // entry (the same data that feeds the P&L's operating-expense line), so it
  // can be reviewed and filtered on its own rather than only as one rolled-up
  // figure inside the P&L.
  getExpenseReport = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const { type, category_id, account_id } = req.query;

      const conditions = ['e.date BETWEEN $1 AND $2'];
      const params = [from, to];
      if (type === 'income' || type === 'expense') { params.push(type); conditions.push(`c.type = $${params.length}`); }
      if (category_id) { params.push(category_id); conditions.push(`e.category_id = $${params.length}`); }
      if (account_id) { params.push(account_id); conditions.push(`e.account_id = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const [entries, byCategory] = await Promise.all([
        db.query(
          `SELECT e.id, e.date, c.name AS category_name, c.type, e.amount, a.name AS account_name, e.description
           FROM income_expense_entries e
           JOIN income_expense_categories c ON e.category_id = c.id
           LEFT JOIN accounts a ON e.account_id = a.id
           ${whereClause}
           ORDER BY e.date DESC, e.id DESC`,
          params
        ),
        db.query(
          `SELECT c.name AS category_name, c.type, COUNT(*) AS entry_count, SUM(e.amount) AS total
           FROM income_expense_entries e
           JOIN income_expense_categories c ON e.category_id = c.id
           ${whereClause}
           GROUP BY c.name, c.type
           ORDER BY total DESC`,
          params
        ),
      ]);

      const items = entries.rows.map((row) => ({ ...row, amount: toNumber(row.amount) }));
      const totalIncome = items.filter((row) => row.type === 'income').reduce((sum, row) => sum + row.amount, 0);
      const totalExpense = items.filter((row) => row.type === 'expense').reduce((sum, row) => sum + row.amount, 0);

      res.json({
        from,
        to,
        items,
        by_category: byCategory.rows.map((row) => ({ ...row, entry_count: toInt(row.entry_count), total: toNumber(row.total) })),
        total_income: totalIncome,
        total_expense: totalExpense,
        net: totalIncome - totalExpense,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Customer Statement of Account - a running ledger of invoices (debits)
  // and payments (credits) for one customer, seeded with whatever balance
  // was already outstanding going into the period. Same shape as the Stock
  // Ledger (StockLedgerController.getLedger), applied to money instead of quantity.
  getCustomerStatement = async (req, res) => {
    const { customer_id } = req.query;
    if (!customer_id) {
      return res.status(400).json({ message: 'customer_id is required' });
    }
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);

      const [customerResult, openingResult, entriesResult] = await Promise.all([
        db.query(`SELECT id, name, customer_type, credit_limit, outstanding_balance FROM customers WHERE id = $1`, [customer_id]),
        db.query(
          `SELECT
             COALESCE((SELECT SUM(net_amount) FROM sales_invoices WHERE customer_id = $1 AND invoice_date < $2), 0)
             - COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales_invoices inv ON p.transaction_id = inv.id
                         WHERE p.transaction_type = 'sale' AND inv.customer_id = $1 AND p.payment_date < $2), 0)
             AS opening_balance`,
          [customer_id, from]
        ),
        db.query(
          `SELECT * FROM (
             SELECT inv.id, inv.invoice_date AS date, 'invoice' AS type, inv.invoice_number AS reference,
                    inv.net_amount AS debit, 0 AS credit
             FROM sales_invoices inv
             WHERE inv.customer_id = $1 AND inv.invoice_date BETWEEN $2 AND $3
             UNION ALL
             SELECT p.id, p.payment_date AS date, 'payment' AS type,
                    COALESCE(p.reference_no, 'Payment #' || p.id) AS reference,
                    0 AS debit, p.amount AS credit
             FROM payments p
             JOIN sales_invoices inv ON p.transaction_id = inv.id AND p.transaction_type = 'sale'
             WHERE inv.customer_id = $1 AND p.payment_date BETWEEN $2 AND $3
           ) entries
           ORDER BY date, type DESC, id`,
          [customer_id, from, to]
        ),
      ]);

      if (customerResult.rows.length === 0) {
        return res.status(404).json({ message: 'Customer not found' });
      }

      const openingBalance = toNumber(openingResult.rows[0].opening_balance);
      let runningBalance = openingBalance;
      const entries = entriesResult.rows.map((row) => {
        const debit = toNumber(row.debit);
        const credit = toNumber(row.credit);
        runningBalance += debit - credit;
        return { ...row, debit, credit, running_balance: runningBalance };
      });

      res.json({
        customer: customerResult.rows[0],
        from,
        to,
        opening_balance: openingBalance,
        closing_balance: runningBalance,
        entries,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Supplier Statement of Account - the same running ledger as
  // getCustomerStatement, mirrored for what we owe a supplier: vouchers
  // (debits, i.e. amounts payable) and payments made (credits).
  getSupplierStatement = async (req, res) => {
    const { supplier_id } = req.query;
    if (!supplier_id) {
      return res.status(400).json({ message: 'supplier_id is required' });
    }
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);

      const [supplierResult, openingResult, entriesResult] = await Promise.all([
        db.query(`SELECT id, name, outstanding_balance FROM suppliers WHERE id = $1`, [supplier_id]),
        db.query(
          `SELECT
             COALESCE((SELECT SUM(net_amount) FROM purchase_vouchers WHERE supplier_id = $1 AND voucher_date < $2), 0)
             - COALESCE((SELECT SUM(p.amount) FROM payments p JOIN purchase_vouchers pv ON p.transaction_id = pv.id
                         WHERE p.transaction_type = 'purchase' AND pv.supplier_id = $1 AND p.payment_date < $2), 0)
             AS opening_balance`,
          [supplier_id, from]
        ),
        db.query(
          `SELECT * FROM (
             SELECT pv.id, pv.voucher_date AS date, 'voucher' AS type, pv.voucher_number AS reference,
                    pv.net_amount AS debit, 0 AS credit
             FROM purchase_vouchers pv
             WHERE pv.supplier_id = $1 AND pv.voucher_date BETWEEN $2 AND $3
             UNION ALL
             SELECT p.id, p.payment_date AS date, 'payment' AS type,
                    COALESCE(p.reference_no, 'Payment #' || p.id) AS reference,
                    0 AS debit, p.amount AS credit
             FROM payments p
             JOIN purchase_vouchers pv ON p.transaction_id = pv.id AND p.transaction_type = 'purchase'
             WHERE pv.supplier_id = $1 AND p.payment_date BETWEEN $2 AND $3
           ) entries
           ORDER BY date, type DESC, id`,
          [supplier_id, from, to]
        ),
      ]);

      if (supplierResult.rows.length === 0) {
        return res.status(404).json({ message: 'Supplier not found' });
      }

      const openingBalance = toNumber(openingResult.rows[0].opening_balance);
      let runningBalance = openingBalance;
      const entries = entriesResult.rows.map((row) => {
        const debit = toNumber(row.debit);
        const credit = toNumber(row.credit);
        runningBalance += debit - credit;
        return { ...row, debit, credit, running_balance: runningBalance };
      });

      res.json({
        supplier: supplierResult.rows[0],
        from,
        to,
        opening_balance: openingBalance,
        closing_balance: runningBalance,
        entries,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Sales Order Backlog - orders not yet delivered or cancelled, with what's
  // been invoiced against each so far. sale_orders already tracks a full
  // status lifecycle; nothing reported what was still open.
  getSalesBacklog = async (req, res) => {
    try {
      const { customer_id, status } = req.query;
      const conditions = [`so.status NOT IN ('delivered', 'cancelled')`];
      const params = [];
      if (customer_id) { params.push(customer_id); conditions.push(`so.customer_id = $${params.length}`); }
      if (status) { params.push(status); conditions.push(`so.status = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const result = await db.query(
        `SELECT so.id, so.so_number, so.order_date, so.status, c.id AS customer_id, c.name AS customer_name,
                so.net_amount AS order_amount,
                COALESCE((SELECT SUM(inv.net_amount) FROM sales_invoices inv WHERE inv.so_id = so.id), 0) AS invoiced_amount,
                (CURRENT_DATE - so.order_date) AS age_days
         FROM sale_orders so
         JOIN customers c ON so.customer_id = c.id
         ${whereClause}
         ORDER BY so.order_date ASC`,
        params
      );

      const items = result.rows.map((row) => {
        const orderAmount = toNumber(row.order_amount);
        const invoicedAmount = toNumber(row.invoiced_amount);
        return {
          ...row,
          order_amount: orderAmount,
          invoiced_amount: invoicedAmount,
          open_amount: orderAmount - invoicedAmount,
          age_days: toInt(row.age_days),
        };
      });

      res.json({
        items,
        total_order_amount: items.reduce((sum, row) => sum + row.order_amount, 0),
        total_invoiced_amount: items.reduce((sum, row) => sum + row.invoiced_amount, 0),
        total_open_amount: items.reduce((sum, row) => sum + row.open_amount, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Open Purchase Orders - orders not yet received or cancelled, with what's
  // been received (invoiced by the supplier) against each so far.
  getOpenPurchaseOrders = async (req, res) => {
    try {
      const { supplier_id, status } = req.query;
      const conditions = [`po.status NOT IN ('received', 'cancelled')`];
      const params = [];
      if (supplier_id) { params.push(supplier_id); conditions.push(`po.supplier_id = $${params.length}`); }
      if (status) { params.push(status); conditions.push(`po.status = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const result = await db.query(
        `SELECT po.id, po.po_number, po.order_date, po.status, s.id AS supplier_id, s.name AS supplier_name,
                po.net_amount AS order_amount,
                COALESCE((SELECT SUM(pv.net_amount) FROM purchase_vouchers pv WHERE pv.po_id = po.id), 0) AS received_amount,
                (CURRENT_DATE - po.order_date) AS age_days
         FROM purchase_orders po
         JOIN suppliers s ON po.supplier_id = s.id
         ${whereClause}
         ORDER BY po.order_date ASC`,
        params
      );

      const items = result.rows.map((row) => {
        const orderAmount = toNumber(row.order_amount);
        const receivedAmount = toNumber(row.received_amount);
        return {
          ...row,
          order_amount: orderAmount,
          received_amount: receivedAmount,
          open_amount: orderAmount - receivedAmount,
          age_days: toInt(row.age_days),
        };
      });

      res.json({
        items,
        total_order_amount: items.reduce((sum, row) => sum + row.order_amount, 0),
        total_received_amount: items.reduce((sum, row) => sum + row.received_amount, 0),
        total_open_amount: items.reduce((sum, row) => sum + row.open_amount, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Inventory Valuation Summary - Current Stock rolled up by category and by
  // warehouse, the view an accountant needs to tie inventory to the balance
  // sheet without reading through every product line.
  getInventoryValuation = async (req, res) => {
    try {
      const { warehouse_id } = req.query;
      const whereClause = warehouse_id ? 'WHERE sl.warehouse_id = $1' : '';
      const params = warehouse_id ? [warehouse_id] : [];

      const [byCategory, byWarehouse] = await Promise.all([
        db.query(
          `SELECT COALESCE(c.name, 'Uncategorized') as category_name,
                  SUM(sl.quantity) as total_quantity, SUM(sl.quantity * p.cost_price) as total_value
           FROM stock_levels sl
           JOIN products p ON sl.product_id = p.id
           LEFT JOIN categories c ON p.category_id = c.id
           ${whereClause}
           GROUP BY category_name
           ORDER BY total_value DESC`,
          params
        ),
        db.query(
          `SELECT w.name as warehouse_name,
                  SUM(sl.quantity) as total_quantity, SUM(sl.quantity * p.cost_price) as total_value
           FROM stock_levels sl
           JOIN products p ON sl.product_id = p.id
           JOIN warehouses w ON sl.warehouse_id = w.id
           ${whereClause}
           GROUP BY w.name
           ORDER BY total_value DESC`,
          params
        ),
      ]);

      const byCategoryRows = byCategory.rows.map((row) => ({ ...row, total_quantity: toNumber(row.total_quantity), total_value: toNumber(row.total_value) }));
      const byWarehouseRows = byWarehouse.rows.map((row) => ({ ...row, total_quantity: toNumber(row.total_quantity), total_value: toNumber(row.total_value) }));

      res.json({
        by_category: byCategoryRows,
        by_warehouse: byWarehouseRows,
        total_value: byWarehouseRows.reduce((sum, row) => sum + row.total_value, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Slow-Moving / Dead Stock - products still on hand that haven't moved (no
  // stock_transactions) in `days` (default 90), valued. Low Stock flags too
  // little on hand; this flags too much sitting idle.
  getSlowMovingStock = async (req, res) => {
    try {
      const days = toInt(req.query.days) || 90;
      const { warehouse_id } = req.query;
      const conditions = ['sl.quantity > 0'];
      const params = [days];
      if (warehouse_id) { params.push(warehouse_id); conditions.push(`sl.warehouse_id = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const query = `
        WITH last_activity AS (
          SELECT product_id, warehouse_id, MAX(created_at) as last_moved
          FROM stock_transactions
          GROUP BY product_id, warehouse_id
        )
        SELECT p.name as product_name, p.product_code, w.name as warehouse_name, sl.quantity,
               p.cost_price, (sl.quantity * p.cost_price) as stock_value,
               la.last_moved,
               COALESCE((CURRENT_DATE - la.last_moved::date), 99999) as days_since_movement
        FROM stock_levels sl
        JOIN products p ON sl.product_id = p.id
        JOIN warehouses w ON sl.warehouse_id = w.id
        LEFT JOIN last_activity la ON la.product_id = sl.product_id AND la.warehouse_id = sl.warehouse_id
        ${whereClause}
        AND COALESCE((CURRENT_DATE - la.last_moved::date), 99999) >= $1
        ORDER BY days_since_movement DESC
      `;
      const result = await db.query(query, params);
      const items = result.rows.map((row) => ({
        ...row,
        quantity: toNumber(row.quantity),
        cost_price: toNumber(row.cost_price),
        stock_value: toNumber(row.stock_value),
        days_since_movement: toInt(row.days_since_movement),
      }));

      res.json({ threshold_days: days, items, total_value: items.reduce((sum, row) => sum + row.stock_value, 0) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // ABC Analysis - ranks products by revenue contribution over the date
  // range and classifies into A (top ~80% of revenue), B (next ~15%), C
  // (remaining ~5%) - the standard Pareto split used to prioritize counting/
  // reorder attention toward what actually matters.
  getAbcAnalysis = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const result = await db.query(
        `SELECT p.id as product_id, p.name as product_name, p.product_code,
                SUM(si.quantity) as total_quantity, SUM(si.subtotal) as revenue
         FROM sales_items si
         JOIN sales_invoices inv ON si.invoice_id = inv.id
         JOIN products p ON si.product_id = p.id
         WHERE inv.invoice_date BETWEEN $1 AND $2
         GROUP BY p.id, p.name, p.product_code
         ORDER BY revenue DESC`,
        [from, to]
      );

      const rows = result.rows.map((row) => ({ ...row, total_quantity: toNumber(row.total_quantity), revenue: toNumber(row.revenue) }));
      const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);

      let cumulative = 0;
      const items = rows.map((row, index) => {
        cumulative += row.revenue;
        const cumulativePercent = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
        const klass = cumulativePercent <= 80 ? 'A' : cumulativePercent <= 95 ? 'B' : 'C';
        return {
          ...row,
          rank: index + 1,
          percent_of_total: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0,
          cumulative_percent: cumulativePercent,
          class: klass,
        };
      });

      const classSummary = ['A', 'B', 'C'].map((klass) => {
        const classItems = items.filter((row) => row.class === klass);
        return { class: klass, product_count: classItems.length, revenue: classItems.reduce((sum, row) => sum + row.revenue, 0) };
      });

      res.json({ from, to, items, total_revenue: totalRevenue, class_summary: classSummary });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Stock Transfer Register - stock_transfers is fully modeled but had no
  // report; in-transit and completed transfers between warehouses were
  // invisible outside the raw record list.
  getStockTransferRegister = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const { from_warehouse_id, to_warehouse_id, status } = req.query;
      const conditions = ['st.date BETWEEN $1 AND $2'];
      const params = [from, to];
      if (from_warehouse_id) { params.push(from_warehouse_id); conditions.push(`st.from_warehouse_id = $${params.length}`); }
      if (to_warehouse_id) { params.push(to_warehouse_id); conditions.push(`st.to_warehouse_id = $${params.length}`); }
      if (status) { params.push(status); conditions.push(`st.status = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const result = await db.query(
        `SELECT st.id, st.transfer_number, st.date, st.status, wf.name as from_warehouse, wt.name as to_warehouse,
                COUNT(sti.id) as item_count, COALESCE(SUM(sti.quantity), 0) as total_quantity,
                COALESCE(SUM(sti.quantity * p.cost_price), 0) as estimated_value
         FROM stock_transfers st
         JOIN warehouses wf ON st.from_warehouse_id = wf.id
         JOIN warehouses wt ON st.to_warehouse_id = wt.id
         LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id
         LEFT JOIN products p ON sti.product_id = p.id
         ${whereClause}
         GROUP BY st.id, st.transfer_number, st.date, st.status, wf.name, wt.name
         ORDER BY st.date DESC`,
        params
      );

      const items = result.rows.map((row) => ({
        ...row,
        item_count: toInt(row.item_count),
        total_quantity: toNumber(row.total_quantity),
        estimated_value: toNumber(row.estimated_value),
      }));

      res.json({ from, to, items, transfer_count: items.length, total_value: items.reduce((sum, row) => sum + row.estimated_value, 0) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Stock Adjustment / Write-off Report - stock_adjustments captures a
  // reason (damaged/missing/expired/manual) per line but had no report;
  // this is the shrinkage figure owners actually ask about.
  getStockAdjustmentReport = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const { warehouse_id, type } = req.query;
      const conditions = ['sa.date BETWEEN $1 AND $2'];
      const params = [from, to];
      if (warehouse_id) { params.push(warehouse_id); conditions.push(`sa.warehouse_id = $${params.length}`); }
      if (type) { params.push(type); conditions.push(`sai.type = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const [items, byType] = await Promise.all([
        db.query(
          `SELECT sa.id, sa.adjustment_number, sa.date, w.name as warehouse_name, sa.reason,
                  sai.type, p.name as product_name, sai.quantity, p.cost_price,
                  (sai.quantity * p.cost_price) as value_impact
           FROM stock_adjustment_items sai
           JOIN stock_adjustments sa ON sai.adjustment_id = sa.id
           JOIN warehouses w ON sa.warehouse_id = w.id
           JOIN products p ON sai.product_id = p.id
           ${whereClause}
           ORDER BY sa.date DESC, sa.id DESC`,
          params
        ),
        db.query(
          `SELECT sai.type, COUNT(*) as line_count, COALESCE(SUM(sai.quantity * p.cost_price), 0) as value_impact
           FROM stock_adjustment_items sai
           JOIN stock_adjustments sa ON sai.adjustment_id = sa.id
           JOIN products p ON sai.product_id = p.id
           ${whereClause}
           GROUP BY sai.type
           ORDER BY value_impact ASC`,
          params
        ),
      ]);

      const itemRows = items.rows.map((row) => ({
        ...row,
        quantity: toNumber(row.quantity),
        cost_price: toNumber(row.cost_price),
        value_impact: toNumber(row.value_impact),
      }));

      res.json({
        from,
        to,
        items: itemRows,
        by_type: byType.rows.map((row) => ({ ...row, line_count: toInt(row.line_count), value_impact: toNumber(row.value_impact) })),
        total_value_impact: itemRows.reduce((sum, row) => sum + row.value_impact, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // PO vs. Voucher Variance - for POs with at least one linked voucher,
  // compares what was ordered to what the supplier actually invoiced. The
  // most basic procurement control, and nothing reported it before.
  getPoVarianceReport = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const { supplier_id } = req.query;
      const conditions = ['po.order_date BETWEEN $1 AND $2'];
      const params = [from, to];
      if (supplier_id) { params.push(supplier_id); conditions.push(`po.supplier_id = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const result = await db.query(
        `SELECT po.id, po.po_number, po.order_date, s.name as supplier_name, po.status,
                po.net_amount as ordered_amount, COALESCE(SUM(pv.net_amount), 0) as vouchered_amount,
                COUNT(pv.id) as voucher_count
         FROM purchase_orders po
         JOIN suppliers s ON po.supplier_id = s.id
         LEFT JOIN purchase_vouchers pv ON pv.po_id = po.id
         ${whereClause}
         GROUP BY po.id, po.po_number, po.order_date, s.name, po.status, po.net_amount
         HAVING COUNT(pv.id) > 0
         ORDER BY po.order_date DESC`,
        params
      );

      const items = result.rows.map((row) => {
        const orderedAmount = toNumber(row.ordered_amount);
        const voucheredAmount = toNumber(row.vouchered_amount);
        const variance = voucheredAmount - orderedAmount;
        return {
          ...row,
          voucher_count: toInt(row.voucher_count),
          ordered_amount: orderedAmount,
          vouchered_amount: voucheredAmount,
          variance,
          variance_percent: orderedAmount > 0 ? (variance / orderedAmount) * 100 : 0,
        };
      });

      res.json({
        from,
        to,
        items,
        significant_variance_count: items.filter((row) => Math.abs(row.variance_percent) > 5).length,
        total_variance: items.reduce((sum, row) => sum + row.variance, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Supplier Price Trend - unit price paid for one product across every
  // voucher over time, to catch creeping supplier prices before they're
  // buried in a total. purchase_items.unit_price was already captured on
  // every voucher; nothing reported it as a trend.
  getSupplierPriceTrend = async (req, res) => {
    const { product_id } = req.query;
    if (!product_id) {
      return res.status(400).json({ message: 'product_id is required' });
    }
    try {
      const result = await db.query(
        `SELECT pv.voucher_date, pv.voucher_number, s.name as supplier_name, pi.unit_price, pi.quantity
         FROM purchase_items pi
         JOIN purchase_vouchers pv ON pi.voucher_id = pv.id
         JOIN suppliers s ON pv.supplier_id = s.id
         WHERE pi.product_id = $1
         ORDER BY pv.voucher_date ASC, pv.id ASC`,
        [product_id]
      );

      const entries = result.rows.map((row) => ({ ...row, unit_price: toNumber(row.unit_price), quantity: toNumber(row.quantity) }));
      const prices = entries.map((row) => row.unit_price);
      const firstPrice = prices.length > 0 ? prices[0] : 0;
      const lastPrice = prices.length > 0 ? prices[prices.length - 1] : 0;

      res.json({
        entries,
        min_price: prices.length > 0 ? Math.min(...prices) : 0,
        max_price: prices.length > 0 ? Math.max(...prices) : 0,
        average_price: prices.length > 0 ? prices.reduce((sum, p) => sum + p, 0) / prices.length : 0,
        first_price: firstPrice,
        last_price: lastPrice,
        change_percent: percentChange(lastPrice, firstPrice),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Cash Flow Statement - inflows (customer payments received, other
  // income) vs. outflows (supplier payments made, expenses), by month.
  // Transfers between the business's own accounts (fund_transfers) are
  // deliberately excluded - a move from cash to bank is neutral at the
  // whole-business level, not an inflow or outflow.
  getCashFlowStatement = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);

      const [totals, byMonth, accounts] = await Promise.all([
        db.query(
          `SELECT
             COALESCE((SELECT SUM(p.amount) FROM payments p JOIN sales_invoices inv ON p.transaction_id = inv.id WHERE p.transaction_type = 'sale' AND p.payment_date BETWEEN $1 AND $2), 0) as customer_payments,
             COALESCE((SELECT SUM(e.amount) FROM income_expense_entries e JOIN income_expense_categories c ON e.category_id = c.id WHERE c.type = 'income' AND e.date BETWEEN $1 AND $2), 0) as other_income,
             COALESCE((SELECT SUM(p.amount) FROM payments p JOIN purchase_vouchers pv ON p.transaction_id = pv.id WHERE p.transaction_type = 'purchase' AND p.payment_date BETWEEN $1 AND $2), 0) as supplier_payments,
             COALESCE((SELECT SUM(e.amount) FROM income_expense_entries e JOIN income_expense_categories c ON e.category_id = c.id WHERE c.type = 'expense' AND e.date BETWEEN $1 AND $2), 0) as expenses`,
          [from, to]
        ),
        db.query(
          `SELECT period, SUM(cash_in) as cash_in, SUM(cash_out) as cash_out
           FROM (
             SELECT TO_CHAR(p.payment_date, 'YYYY-MM') as period, p.amount as cash_in, 0 as cash_out
             FROM payments p JOIN sales_invoices inv ON p.transaction_id = inv.id
             WHERE p.transaction_type = 'sale' AND p.payment_date BETWEEN $1 AND $2
             UNION ALL
             SELECT TO_CHAR(e.date, 'YYYY-MM'), e.amount, 0
             FROM income_expense_entries e JOIN income_expense_categories c ON e.category_id = c.id
             WHERE c.type = 'income' AND e.date BETWEEN $1 AND $2
             UNION ALL
             SELECT TO_CHAR(p.payment_date, 'YYYY-MM'), 0, p.amount
             FROM payments p JOIN purchase_vouchers pv ON p.transaction_id = pv.id
             WHERE p.transaction_type = 'purchase' AND p.payment_date BETWEEN $1 AND $2
             UNION ALL
             SELECT TO_CHAR(e.date, 'YYYY-MM'), 0, e.amount
             FROM income_expense_entries e JOIN income_expense_categories c ON e.category_id = c.id
             WHERE c.type = 'expense' AND e.date BETWEEN $1 AND $2
           ) combined
           GROUP BY period
           ORDER BY period`,
          [from, to]
        ),
        db.query(`SELECT COALESCE(SUM(balance), 0) as total FROM accounts`),
      ]);

      const t = totals.rows[0];
      const customerPayments = toNumber(t.customer_payments);
      const otherIncome = toNumber(t.other_income);
      const supplierPayments = toNumber(t.supplier_payments);
      const expenses = toNumber(t.expenses);
      const totalIn = customerPayments + otherIncome;
      const totalOut = supplierPayments + expenses;

      res.json({
        from,
        to,
        customer_payments: customerPayments,
        other_income: otherIncome,
        total_cash_in: totalIn,
        supplier_payments: supplierPayments,
        expenses,
        total_cash_out: totalOut,
        net_cash_flow: totalIn - totalOut,
        current_cash_bank_balance: toNumber(accounts.rows[0].total),
        by_month: byMonth.rows.map((row) => ({
          period: row.period,
          cash_in: toNumber(row.cash_in),
          cash_out: toNumber(row.cash_out),
          net: toNumber(row.cash_in) - toNumber(row.cash_out),
        })),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Fund Transfer Register - an audit list over fund_transfers (deposits,
  // withdrawals, and inter-account transfers), which had no report of its own.
  getFundTransferRegister = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const result = await db.query(
        `SELECT ft.id, ft.transfer_number, ft.date, fa.name as from_account, ta.name as to_account, ft.amount, ft.remark
         FROM fund_transfers ft
         JOIN accounts fa ON ft.from_account_id = fa.id
         JOIN accounts ta ON ft.to_account_id = ta.id
         WHERE ft.date BETWEEN $1 AND $2
         ORDER BY ft.date DESC, ft.id DESC`,
        [from, to]
      );
      const items = result.rows.map((row) => ({ ...row, amount: toNumber(row.amount) }));
      res.json({ from, to, items, transfer_count: items.length, total_amount: items.reduce((sum, row) => sum + row.amount, 0) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Delivery Performance - deliveries tracks a status lifecycle (pending/
  // shipped/delivered/failed) per truck run but had no report; on-time vs.
  // failed rate was invisible outside the raw record list.
  getDeliveryPerformance = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const [items, byStatus] = await Promise.all([
        db.query(
          `SELECT d.id, d.delivery_number, d.date, d.vehicle_info, d.driver_name, d.status,
                  COUNT(di.invoice_id) as invoice_count
           FROM deliveries d
           LEFT JOIN delivery_invoices di ON di.delivery_id = d.id
           WHERE d.date BETWEEN $1 AND $2
           GROUP BY d.id, d.delivery_number, d.date, d.vehicle_info, d.driver_name, d.status
           ORDER BY d.date DESC`,
          [from, to]
        ),
        db.query(`SELECT status, COUNT(*) as count FROM deliveries WHERE date BETWEEN $1 AND $2 GROUP BY status`, [from, to]),
      ]);

      const statusCounts = Object.fromEntries(byStatus.rows.map((row) => [row.status, toInt(row.count)]));
      const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
      const delivered = statusCounts.delivered || 0;
      const failed = statusCounts.failed || 0;

      res.json({
        from,
        to,
        items: items.rows.map((row) => ({ ...row, invoice_count: toInt(row.invoice_count) })),
        status_counts: statusCounts,
        total_deliveries: total,
        delivered_rate: total > 0 ? (delivered / total) * 100 : 0,
        failed_rate: total > 0 ? (failed / total) * 100 : 0,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Document Register - a single filterable index across every transactional
  // document (POs, purchase vouchers, sale orders, sales invoices) by status
  // and date, useful for month-end close and an auditor's sampling.
  getDocumentRegister = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const { document_type } = req.query;

      const result = await db.query(
        `SELECT * FROM (
           SELECT 'purchase_order' as document_type, po.po_number as document_number, s.name as party_name,
                  po.order_date as document_date, po.status, po.net_amount as amount
           FROM purchase_orders po JOIN suppliers s ON po.supplier_id = s.id
           WHERE po.order_date BETWEEN $1 AND $2
           UNION ALL
           SELECT 'purchase_voucher', pv.voucher_number, s.name, pv.voucher_date, pv.payment_status, pv.net_amount
           FROM purchase_vouchers pv JOIN suppliers s ON pv.supplier_id = s.id
           WHERE pv.voucher_date BETWEEN $1 AND $2
           UNION ALL
           SELECT 'sale_order', so.so_number, c.name, so.order_date, so.status, so.net_amount
           FROM sale_orders so JOIN customers c ON so.customer_id = c.id
           WHERE so.order_date BETWEEN $1 AND $2
           UNION ALL
           SELECT 'sales_invoice', inv.invoice_number, c.name, inv.invoice_date, inv.payment_status, inv.net_amount
           FROM sales_invoices inv JOIN customers c ON inv.customer_id = c.id
           WHERE inv.invoice_date BETWEEN $1 AND $2
         ) documents
         ${document_type ? 'WHERE document_type = $3' : ''}
         ORDER BY document_date DESC`,
        document_type ? [from, to, document_type] : [from, to]
      );

      const items = result.rows.map((row) => ({ ...row, amount: toNumber(row.amount) }));
      res.json({
        from,
        to,
        items,
        total_count: items.length,
        by_type: ['purchase_order', 'purchase_voucher', 'sale_order', 'sales_invoice'].map((type) => ({
          document_type: type,
          count: items.filter((row) => row.document_type === type).length,
          total_amount: items.filter((row) => row.document_type === type).reduce((sum, row) => sum + row.amount, 0),
        })),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Salesperson Performance - revenue and invoice count per rep, using the
  // salesperson_id now captured on sales_invoices. "Unassigned" is broken
  // out separately rather than silently dropped, since older invoices (and
  // any invoice created without picking a rep) have no salesperson at all.
  getSalespersonPerformance = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const [result, unassignedResult] = await Promise.all([
        db.query(
          `SELECT u.id as salesperson_id, u.full_name as salesperson_name,
                  COUNT(inv.id) as invoice_count,
                  COALESCE(SUM(inv.total_amount - inv.discount_amount), 0) as net_sales
           FROM sales_invoices inv
           JOIN users u ON inv.salesperson_id = u.id
           WHERE inv.invoice_date BETWEEN $1 AND $2
           GROUP BY u.id, u.full_name
           ORDER BY net_sales DESC`,
          [from, to]
        ),
        db.query(
          `SELECT COUNT(*) as invoice_count, COALESCE(SUM(total_amount - discount_amount), 0) as net_sales
           FROM sales_invoices WHERE invoice_date BETWEEN $1 AND $2 AND salesperson_id IS NULL`,
          [from, to]
        ),
      ]);

      const items = result.rows.map((row) => {
        const invoiceCount = toInt(row.invoice_count);
        const netSales = toNumber(row.net_sales);
        return { ...row, invoice_count: invoiceCount, net_sales: netSales, average_invoice_value: invoiceCount > 0 ? netSales / invoiceCount : 0 };
      });

      res.json({
        from,
        to,
        items,
        unassigned: {
          invoice_count: toInt(unassignedResult.rows[0].invoice_count),
          net_sales: toNumber(unassignedResult.rows[0].net_sales),
        },
        total_net_sales: items.reduce((sum, row) => sum + row.net_sales, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Supplier Performance Scorecard - on-time delivery rate (voucher's actual
  // received_date vs. the PO's expected_date) and quality-rating mix, using
  // fields now captured on purchase_orders/purchase_vouchers. on_time_rate
  // is null (not 0%) when a supplier has no PO-linked, expected-date-bearing
  // vouchers in range - there's no data to score them on, which is different
  // from actually always being late.
  getSupplierScorecard = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const result = await db.query(
        `SELECT s.id as supplier_id, s.name as supplier_name,
                COUNT(pv.id) as voucher_count,
                COALESCE(SUM(pv.net_amount), 0) as total_spend,
                COUNT(pv.id) FILTER (WHERE po.expected_date IS NOT NULL AND pv.received_date <= po.expected_date) as on_time_count,
                COUNT(pv.id) FILTER (WHERE po.expected_date IS NOT NULL) as due_count,
                COUNT(pv.id) FILTER (WHERE pv.quality_rating = 'good') as good_count,
                COUNT(pv.id) FILTER (WHERE pv.quality_rating = 'minor_issues') as minor_issues_count,
                COUNT(pv.id) FILTER (WHERE pv.quality_rating = 'rejected') as rejected_count
         FROM purchase_vouchers pv
         JOIN suppliers s ON pv.supplier_id = s.id
         LEFT JOIN purchase_orders po ON pv.po_id = po.id
         WHERE pv.voucher_date BETWEEN $1 AND $2
         GROUP BY s.id, s.name
         ORDER BY total_spend DESC`,
        [from, to]
      );

      const items = result.rows.map((row) => {
        const dueCount = toInt(row.due_count);
        const onTimeCount = toInt(row.on_time_count);
        const voucherCount = toInt(row.voucher_count);
        return {
          ...row,
          voucher_count: voucherCount,
          total_spend: toNumber(row.total_spend),
          on_time_count: onTimeCount,
          due_count: dueCount,
          on_time_rate: dueCount > 0 ? (onTimeCount / dueCount) * 100 : null,
          good_count: toInt(row.good_count),
          minor_issues_count: toInt(row.minor_issues_count),
          rejected_count: toInt(row.rejected_count),
          quality_rate: voucherCount > 0 ? (toInt(row.good_count) / voucherCount) * 100 : 0,
        };
      });

      res.json({ from, to, items });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Expiry Report - batches with an expiry date, from both purchased goods
  // and produced finished goods, nearest expiry first. Scope note (see
  // migrations/009_add_batch_lot_expiry_tracking.sql): this reports what was
  // received/produced with an expiry date, not a live per-lot remaining
  // quantity - stock deduction on sale still isn't lot-aware, so a lot shown
  // here may already be partly or fully sold through.
  getExpiryReport = async (req, res) => {
    try {
      const days = req.query.days ? toInt(req.query.days) : null;
      // days is coerced through toInt above, so interpolating it into the
      // INTERVAL literal (which can't be a bound parameter) is still safe.
      const cutoffClause = days !== null ? `WHERE expiry_date <= CURRENT_DATE + INTERVAL '${days} days'` : '';

      const result = await db.query(
        `SELECT * FROM (
           SELECT 'purchased' as source, pi.lot_number, pi.expiry_date, p.name as product_name, p.product_code,
                  w.name as warehouse_name, pi.quantity, pv.voucher_number as reference, pv.voucher_date as source_date
           FROM purchase_items pi
           JOIN purchase_vouchers pv ON pi.voucher_id = pv.id
           JOIN products p ON pi.product_id = p.id
           JOIN warehouses w ON pv.warehouse_id = w.id
           WHERE pi.expiry_date IS NOT NULL
           UNION ALL
           SELECT 'produced', pfg.lot_number, pfg.expiry_date, p.name, p.product_code,
                  w.name, pfg.quantity, pb.batch_number, pb.end_date::date
           FROM production_finished_goods pfg
           JOIN production_batches pb ON pfg.batch_id = pb.id
           JOIN products p ON pfg.product_id = p.id
           JOIN warehouses w ON pfg.warehouse_id = w.id
           WHERE pfg.expiry_date IS NOT NULL
         ) batches
         ${cutoffClause}
         ORDER BY expiry_date ASC`
      );

      const items = result.rows.map((row) => ({
        ...row,
        quantity: toNumber(row.quantity),
        days_until_expiry: Math.ceil((new Date(row.expiry_date) - new Date()) / (1000 * 60 * 60 * 24)),
      }));

      res.json({
        items,
        expiring_soon_count: items.filter((row) => row.days_until_expiry >= 0 && row.days_until_expiry <= 30).length,
        already_expired_count: items.filter((row) => row.days_until_expiry < 0).length,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Sales Returns Report - every credit note in the period, by customer and
  // by reason, so returns show up as their own figure instead of being
  // invisible inside net sales.
  getSalesReturnsReport = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const result = await db.query(
        `SELECT sr.id, sr.return_number, sr.return_date, c.name as customer_name, w.name as warehouse_name,
                inv.invoice_number, sr.reason, sr.total_amount
         FROM sales_returns sr
         JOIN customers c ON sr.customer_id = c.id
         JOIN warehouses w ON sr.warehouse_id = w.id
         LEFT JOIN sales_invoices inv ON sr.invoice_id = inv.id
         WHERE sr.return_date BETWEEN $1 AND $2
         ORDER BY sr.return_date DESC`,
        [from, to]
      );
      const items = result.rows.map((row) => ({ ...row, total_amount: toNumber(row.total_amount) }));

      const byCustomerMap = new Map();
      items.forEach((row) => {
        const existing = byCustomerMap.get(row.customer_name) || { customer_name: row.customer_name, return_count: 0, total_amount: 0 };
        existing.return_count += 1;
        existing.total_amount += row.total_amount;
        byCustomerMap.set(row.customer_name, existing);
      });

      res.json({
        from,
        to,
        items,
        by_customer: Array.from(byCustomerMap.values()).sort((a, b) => b.total_amount - a.total_amount),
        return_count: items.length,
        total_amount: items.reduce((sum, row) => sum + row.total_amount, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Purchase Returns Report - every debit note in the period, mirroring
  // getSalesReturnsReport for goods sent back to suppliers.
  getPurchaseReturnsReport = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const result = await db.query(
        `SELECT pr.id, pr.return_number, pr.return_date, s.name as supplier_name, w.name as warehouse_name,
                pv.voucher_number, pr.reason, pr.total_amount
         FROM purchase_returns pr
         JOIN suppliers s ON pr.supplier_id = s.id
         JOIN warehouses w ON pr.warehouse_id = w.id
         LEFT JOIN purchase_vouchers pv ON pr.voucher_id = pv.id
         WHERE pr.return_date BETWEEN $1 AND $2
         ORDER BY pr.return_date DESC`,
        [from, to]
      );
      const items = result.rows.map((row) => ({ ...row, total_amount: toNumber(row.total_amount) }));

      const bySupplierMap = new Map();
      items.forEach((row) => {
        const existing = bySupplierMap.get(row.supplier_name) || { supplier_name: row.supplier_name, return_count: 0, total_amount: 0 };
        existing.return_count += 1;
        existing.total_amount += row.total_amount;
        bySupplierMap.set(row.supplier_name, existing);
      });

      res.json({
        from,
        to,
        items,
        by_supplier: Array.from(bySupplierMap.values()).sort((a, b) => b.total_amount - a.total_amount),
        return_count: items.length,
        total_amount: items.reduce((sum, row) => sum + row.total_amount, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Chart of Accounts - every system GL account with its net balance as of
  // a date, computed from journal_entry_lines. See migrations/
  // 011_add_chart_of_accounts_and_general_ledger.sql and src/utils/
  // journalPoster.js for how this ledger is fed and its scope/limits.
  getChartOfAccounts = async (req, res) => {
    try {
      const asOf = req.query.as_of || todayUtcIsoDate();
      const result = await db.query(
        `SELECT coa.id, coa.code, coa.name, coa.account_type, coa.normal_balance,
                COALESCE(SUM(activity.debit), 0) as total_debit, COALESCE(SUM(activity.credit), 0) as total_credit
         FROM chart_of_accounts coa
         LEFT JOIN (
           SELECT jel.account_id, jel.debit, jel.credit
           FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE je.entry_date <= $1
         ) activity ON activity.account_id = coa.id
         GROUP BY coa.id, coa.code, coa.name, coa.account_type, coa.normal_balance
         ORDER BY coa.code`,
        [asOf]
      );
      const items = result.rows.map((row) => {
        const debit = toNumber(row.total_debit);
        const credit = toNumber(row.total_credit);
        return { ...row, total_debit: debit, total_credit: credit, balance: row.normal_balance === 'debit' ? debit - credit : credit - debit };
      });
      res.json({ as_of: asOf, items });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Trial Balance - every account with activity, net balance on its normal
  // side, as of a date. Debits and credits always tie out by construction
  // (every posted entry is itself balanced) - if they ever don't, that
  // means a journal_entry_lines row was inserted outside postJournalEntry.
  getTrialBalance = async (req, res) => {
    try {
      const asOf = req.query.as_of || todayUtcIsoDate();
      const result = await db.query(
        `SELECT coa.code, coa.name, coa.account_type,
                COALESCE(SUM(activity.debit), 0) as total_debit, COALESCE(SUM(activity.credit), 0) as total_credit
         FROM chart_of_accounts coa
         LEFT JOIN (
           SELECT jel.account_id, jel.debit, jel.credit
           FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE je.entry_date <= $1
         ) activity ON activity.account_id = coa.id
         GROUP BY coa.code, coa.name, coa.account_type
         HAVING COALESCE(SUM(activity.debit), 0) <> 0 OR COALESCE(SUM(activity.credit), 0) <> 0
         ORDER BY coa.code`,
        [asOf]
      );

      const items = result.rows.map((row) => {
        const debit = toNumber(row.total_debit);
        const credit = toNumber(row.total_credit);
        const net = debit - credit;
        return { code: row.code, name: row.name, account_type: row.account_type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
      });
      const totalDebit = items.reduce((sum, row) => sum + row.debit, 0);
      const totalCredit = items.reduce((sum, row) => sum + row.credit, 0);

      res.json({ as_of: asOf, items, total_debit: totalDebit, total_credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Balance Sheet - Assets = Liabilities + Equity as of a date. Equity =
  // Owner's Equity (the opening-balance plug) + Retained Earnings (every
  // income and expense account's net balance to date, since this system
  // has no period-close/year-end rollover step).
  getBalanceSheet = async (req, res) => {
    try {
      const asOf = req.query.as_of || todayUtcIsoDate();
      const result = await db.query(
        `SELECT coa.code, coa.name, coa.account_type, coa.normal_balance,
                COALESCE(SUM(activity.debit), 0) as total_debit, COALESCE(SUM(activity.credit), 0) as total_credit
         FROM chart_of_accounts coa
         LEFT JOIN (
           SELECT jel.account_id, jel.debit, jel.credit
           FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE je.entry_date <= $1
         ) activity ON activity.account_id = coa.id
         GROUP BY coa.code, coa.name, coa.account_type, coa.normal_balance
         ORDER BY coa.code`,
        [asOf]
      );

      const rows = result.rows.map((row) => {
        const debit = toNumber(row.total_debit);
        const credit = toNumber(row.total_credit);
        return { code: row.code, name: row.name, account_type: row.account_type, balance: row.normal_balance === 'debit' ? debit - credit : credit - debit };
      });

      const assets = rows.filter((row) => row.account_type === 'asset');
      const liabilities = rows.filter((row) => row.account_type === 'liability');
      const equityAccounts = rows.filter((row) => row.account_type === 'equity');
      const income = rows.filter((row) => row.account_type === 'income');
      const expenses = rows.filter((row) => row.account_type === 'expense');

      const totalAssets = assets.reduce((sum, row) => sum + row.balance, 0);
      const totalLiabilities = liabilities.reduce((sum, row) => sum + row.balance, 0);
      const ownersEquity = equityAccounts.reduce((sum, row) => sum + row.balance, 0);
      const netIncome = income.reduce((sum, row) => sum + row.balance, 0) - expenses.reduce((sum, row) => sum + row.balance, 0);
      const totalEquity = ownersEquity + netIncome;

      res.json({
        as_of: asOf,
        assets,
        total_assets: totalAssets,
        liabilities,
        total_liabilities: totalLiabilities,
        equity: [...equityAccounts, { code: '3900', name: 'Retained Earnings (Net Income to Date)', account_type: 'equity', balance: netIncome }],
        total_equity: totalEquity,
        total_liabilities_and_equity: totalLiabilities + totalEquity,
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Journal Register - every posted entry (and its lines) in a date range,
  // for auditing what the GL actually recorded and troubleshooting it.
  getJournalRegister = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);
      const { reference_type } = req.query;
      const conditions = ['je.entry_date BETWEEN $1 AND $2'];
      const params = [from, to];
      if (reference_type) { params.push(reference_type); conditions.push(`je.reference_type = $${params.length}`); }
      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      const result = await db.query(
        `SELECT je.id, je.entry_date, je.reference_type, je.reference_id, je.description,
                json_agg(json_build_object('account_code', coa.code, 'account_name', coa.name, 'debit', jel.debit, 'credit', jel.credit) ORDER BY jel.id) as lines
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON jel.account_id = coa.id
         ${whereClause}
         GROUP BY je.id, je.entry_date, je.reference_type, je.reference_id, je.description
         ORDER BY je.entry_date DESC, je.id DESC`,
        params
      );

      const items = result.rows.map((row) => ({
        ...row,
        lines: row.lines.map((line) => ({ ...line, debit: toNumber(line.debit), credit: toNumber(line.credit) })),
      }));

      res.json({ from, to, items, entry_count: items.length });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Sales by Category - the same margin convention as getSalesSummary's
  // by_product, just grouped one level up.
  getSalesByCategory = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);

      const result = await db.query(
        `SELECT COALESCE(cat.id, 0) as category_id, COALESCE(cat.name, 'Uncategorized') as category_name,
                SUM(si.quantity) as total_quantity, SUM(si.subtotal) as total_revenue,
                SUM(si.quantity * p.cost_price) as total_cost
         FROM sales_items si
         JOIN sales_invoices inv ON si.invoice_id = inv.id
         JOIN products p ON si.product_id = p.id
         LEFT JOIN categories cat ON p.category_id = cat.id
         WHERE inv.invoice_date BETWEEN $1 AND $2
         GROUP BY cat.id, cat.name
         ORDER BY total_revenue DESC`,
        [from, to]
      );

      const items = result.rows.map((row) => {
        const totalRevenue = toNumber(row.total_revenue);
        const totalCost = toNumber(row.total_cost);
        const margin = totalRevenue - totalCost;
        return {
          ...row,
          total_quantity: toNumber(row.total_quantity),
          total_revenue: totalRevenue,
          total_cost: totalCost,
          margin,
          margin_percent: totalRevenue > 0 ? (margin / totalRevenue) * 100 : 0,
        };
      });

      res.json({
        from,
        to,
        items,
        total_revenue: items.reduce((sum, row) => sum + row.total_revenue, 0),
        total_margin: items.reduce((sum, row) => sum + row.margin, 0),
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Payment Method Analysis - how customers are actually paying.
  getPaymentMethodAnalysis = async (req, res) => {
    try {
      const { from, to } = resolveDateRange(req.query.from, req.query.to);

      const result = await db.query(
        `SELECT pm.id as payment_method_id, pm.name as method_name,
                COUNT(pay.id) as transaction_count, COALESCE(SUM(pay.amount), 0) as total_amount
         FROM payments pay
         JOIN payment_methods pm ON pay.payment_method_id = pm.id
         WHERE pay.transaction_type = 'sale' AND pay.payment_date BETWEEN $1 AND $2
         GROUP BY pm.id, pm.name
         ORDER BY total_amount DESC`,
        [from, to]
      );

      const items = result.rows.map((row) => ({
        ...row,
        transaction_count: toInt(row.transaction_count),
        total_amount: toNumber(row.total_amount),
      }));
      const grandTotal = items.reduce((sum, row) => sum + row.total_amount, 0);

      res.json({
        from,
        to,
        items: items.map((row) => ({ ...row, percent_of_total: grandTotal > 0 ? (row.total_amount / grandTotal) * 100 : 0 })),
        total_amount: grandTotal,
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new ReportController();
