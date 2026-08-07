-- Splits the 2 umbrella report permissions (view_reports, covering 21 report
-- pages incl. Stock Ledger; view_financial_reports, covering 16) into one
-- permission per report page, so a role can be given access to individual
-- reports instead of all-or-nothing within each bucket. Mirrors the same
-- pattern as migration 019 (see src/routes/reportRoutes.js,
-- stockLedgerRoutes.js and permissions.js for the new constants). Safe to
-- re-run: every insert is guarded with ON CONFLICT DO NOTHING and the final
-- DELETE is a no-op once the old rows are gone.

-- ==========================================
-- 1. New per-report permissions
-- ==========================================

INSERT INTO permissions (name, module, description) VALUES
    ('view_report_current_stock', 'Reports', 'Can view the Current Stock report'),
    ('view_report_low_stock', 'Reports', 'Can view the Low Stock report'),
    ('view_report_stock_movement', 'Reports', 'Can view the Stock Movement report'),
    ('view_report_stock_ledger', 'Reports', 'Can view the Stock Ledger report'),
    ('view_report_purchase_summary', 'Reports', 'Can view the Purchase Summary report'),
    ('view_report_production_summary', 'Reports', 'Can view the Production Summary report'),
    ('view_report_sales_backlog', 'Reports', 'Can view the Sales Order Backlog report'),
    ('view_report_open_purchase_orders', 'Reports', 'Can view the Open Purchase Orders report'),
    ('view_report_inventory_valuation', 'Reports', 'Can view the Inventory Valuation report'),
    ('view_report_slow_moving_stock', 'Reports', 'Can view the Slow-Moving Stock report'),
    ('view_report_abc_analysis', 'Reports', 'Can view the ABC Analysis report'),
    ('view_report_stock_transfer_register', 'Reports', 'Can view the Stock Transfer Register report'),
    ('view_report_stock_adjustments', 'Reports', 'Can view the Stock Adjustments report'),
    ('view_report_po_variance', 'Reports', 'Can view the PO Variance report'),
    ('view_report_supplier_price_trend', 'Reports', 'Can view the Supplier Price Trend report'),
    ('view_report_delivery_performance', 'Reports', 'Can view the Delivery Performance report'),
    ('view_report_document_register', 'Reports', 'Can view the Document Register report'),
    ('view_report_supplier_scorecard', 'Reports', 'Can view the Supplier Scorecard report'),
    ('view_report_expiry', 'Reports', 'Can view the Expiry report'),
    ('view_report_sales_returns', 'Reports', 'Can view the Sales Returns report'),
    ('view_report_purchase_returns', 'Reports', 'Can view the Purchase Returns report'),
    ('view_report_sales_summary', 'Reports', 'Can view the Sales Summary report'),
    ('view_report_outstanding', 'Reports', 'Can view the Outstanding Balances report'),
    ('view_report_profit_loss', 'Reports', 'Can view the Profit & Loss report'),
    ('view_report_tax_summary', 'Reports', 'Can view the Tax / VAT Summary report'),
    ('view_report_expense', 'Reports', 'Can view the Income & Expense report'),
    ('view_report_customer_statement', 'Reports', 'Can view the Customer Statement report'),
    ('view_report_supplier_statement', 'Reports', 'Can view the Supplier Statement report'),
    ('view_report_cash_flow', 'Reports', 'Can view the Cash Flow Statement report'),
    ('view_report_fund_transfer_register', 'Reports', 'Can view the Fund Transfer Register report'),
    ('view_report_salesperson_performance', 'Reports', 'Can view the Salesperson Performance report'),
    ('view_report_chart_of_accounts', 'Reports', 'Can view the Chart of Accounts report'),
    ('view_report_trial_balance', 'Reports', 'Can view the Trial Balance report'),
    ('view_report_balance_sheet', 'Reports', 'Can view the Balance Sheet report'),
    ('view_report_journal_register', 'Reports', 'Can view the Journal Register report'),
    ('view_report_sales_by_category', 'Reports', 'Can view the Sales by Category report'),
    ('view_report_payment_method_analysis', 'Reports', 'Can view the Payment Method Analysis report')
ON CONFLICT (name) DO NOTHING;

-- ==========================================
-- 2. Auto-grant equivalents: every role that currently holds view_reports
--    gets every operational report permission (incl. Stock Ledger, which
--    was also gated by view_reports); every role with view_financial_reports
--    gets every financial report permission. Driven off the live
--    role_permissions table, so it reflects whatever roles actually have
--    today, however they got there.
-- ==========================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN (
    'view_report_current_stock', 'view_report_low_stock', 'view_report_stock_movement',
    'view_report_stock_ledger', 'view_report_purchase_summary', 'view_report_production_summary',
    'view_report_sales_backlog', 'view_report_open_purchase_orders', 'view_report_inventory_valuation',
    'view_report_slow_moving_stock', 'view_report_abc_analysis', 'view_report_stock_transfer_register',
    'view_report_stock_adjustments', 'view_report_po_variance', 'view_report_supplier_price_trend',
    'view_report_delivery_performance', 'view_report_document_register', 'view_report_supplier_scorecard',
    'view_report_expiry', 'view_report_sales_returns', 'view_report_purchase_returns'
)
WHERE old_p.name = 'view_reports'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN (
    'view_report_sales_summary', 'view_report_outstanding', 'view_report_profit_loss',
    'view_report_tax_summary', 'view_report_expense', 'view_report_customer_statement',
    'view_report_supplier_statement', 'view_report_cash_flow', 'view_report_fund_transfer_register',
    'view_report_salesperson_performance', 'view_report_chart_of_accounts', 'view_report_trial_balance',
    'view_report_balance_sheet', 'view_report_journal_register', 'view_report_sales_by_category',
    'view_report_payment_method_analysis'
)
WHERE old_p.name = 'view_financial_reports'
ON CONFLICT DO NOTHING;

-- ==========================================
-- 3. The old umbrella permissions no longer gate any route (see
--    src/routes/reportRoutes.js, stockLedgerRoutes.js) - remove them.
--    role_permissions rows referencing them cascade-delete automatically.
-- ==========================================

DELETE FROM permissions WHERE name IN ('view_reports', 'view_financial_reports');
