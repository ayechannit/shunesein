-- Rolls back the Quotations/Credit Approvals workflow, Payment Terms, Tax
-- Rates, and the entire POS (registers/shifts/checkout) module. Sale Orders
-- and Sales Invoices themselves stay, along with per-line discount_percent
-- and the simpler product-level quantity-tier pricing added alongside this
-- migration (see 015_replace_price_lists_with_product_tiers.sql and
-- pricingEngine.js). Safe to re-run.

-- Drop every column that references a table being dropped below, before
-- dropping that table - otherwise the DROP TABLE fails with a dependency error.
ALTER TABLE products DROP COLUMN IF EXISTS tax_rate_id;
ALTER TABLE sale_orders DROP COLUMN IF EXISTS payment_terms_id;
ALTER TABLE sale_orders DROP COLUMN IF EXISTS quotation_id;
ALTER TABLE sales_invoices DROP COLUMN IF EXISTS payment_terms_id;
ALTER TABLE customers DROP COLUMN IF EXISTS payment_terms_id;

ALTER TABLE sales_invoices DROP COLUMN IF EXISTS due_date;
ALTER TABLE sales_invoices DROP COLUMN IF EXISTS channel;
ALTER TABLE payment_methods DROP COLUMN IF EXISTS affects_cash_drawer;

DROP TABLE IF EXISTS quotation_items;
DROP TABLE IF EXISTS quotations;
DROP TABLE IF EXISTS credit_approvals;

DROP TABLE IF EXISTS pos_sales;
DROP TABLE IF EXISTS pos_shifts;
DROP TABLE IF EXISTS pos_registers;

DROP TABLE IF EXISTS payment_terms;
DROP TABLE IF EXISTS tax_rates;

-- approve_credit / pos_* permissions no longer have any route to gate.
-- manage_price_lists stays - it now gates the quantity-tier pricing screen.
-- role_permissions rows for the deleted permissions cascade-delete automatically.
DELETE FROM permissions WHERE name IN ('approve_credit', 'pos_operate', 'pos_override', 'pos_manage');

-- The Wholesale/Retail revenue split (migration 012) is undone: back to one
-- Sales Revenue account. Only drop the Retail Revenue account if nothing
-- was ever actually posted to it - if it has real history, leave it in
-- place (dormant) rather than corrupt past reports by deleting it.
UPDATE chart_of_accounts SET name = 'Sales Revenue' WHERE code = '4000';
DELETE FROM chart_of_accounts
WHERE code = '4010'
  AND NOT EXISTS (
    SELECT 1 FROM journal_entry_lines jel
    JOIN chart_of_accounts coa ON jel.account_id = coa.id
    WHERE coa.code = '4010'
  );
