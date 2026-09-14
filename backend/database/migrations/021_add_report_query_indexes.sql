-- No indexes existed on the date/FK columns the Reports module (34 report
-- endpoints in ReportController.js) and the Dashboard filter, join, and
-- sort by - fine at demo data volume, but every one of these becomes a
-- sequential scan as real transaction history accumulates. Idempotent
-- (IF NOT EXISTS) - safe to re-run.

-- Sales: date-range and customer filters (getSalesSummary, getOutstanding,
-- getCustomerStatement, Dashboard today's-sales, AR aging), and the
-- invoice -> items join used by nearly every sales report.
CREATE INDEX IF NOT EXISTS idx_sales_invoices_invoice_date ON sales_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_id ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_invoice_id ON sales_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sale_orders_customer_id ON sale_orders(customer_id);

-- Purchases: same shape on the supplier side (getPurchaseSummary,
-- getOutstanding, getSupplierStatement, Dashboard today's-purchases, AP aging).
CREATE INDEX IF NOT EXISTS idx_purchase_vouchers_voucher_date ON purchase_vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_purchase_vouchers_supplier_id ON purchase_vouchers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_voucher_id ON purchase_items(voucher_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);

-- Payments: every outstanding-balance calculation correlates a subquery
-- against (transaction_type, transaction_id); cash flow/payment-method
-- reports filter by payment_date.
CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_type, transaction_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);

-- Stock ledger/movement reports and the current-stock/valuation reports
-- filter and order by these on stock_transactions directly.
CREATE INDEX IF NOT EXISTS idx_stock_transactions_product_warehouse ON stock_transactions(product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_created_at ON stock_transactions(created_at);

-- Stock transfer/adjustment registers and production summary.
CREATE INDEX IF NOT EXISTS idx_stock_transfers_date ON stock_transfers(date);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_date ON stock_adjustments(date);
CREATE INDEX IF NOT EXISTS idx_production_batches_start_date ON production_batches(start_date);

-- Delivery performance report.
CREATE INDEX IF NOT EXISTS idx_deliveries_date ON deliveries(date);

-- Income/expense report and P&L (getProfitLoss joins on category type+date).
CREATE INDEX IF NOT EXISTS idx_income_expense_entries_date ON income_expense_entries(date);
CREATE INDEX IF NOT EXISTS idx_income_expense_entries_category_id ON income_expense_entries(category_id);

-- Balance sheet, trial balance, cash flow, and journal register all filter
-- journal_entries by date; migration 011 only indexed (reference_type,
-- reference_id), not entry_date.
CREATE INDEX IF NOT EXISTS idx_journal_entries_entry_date ON journal_entries(entry_date);
