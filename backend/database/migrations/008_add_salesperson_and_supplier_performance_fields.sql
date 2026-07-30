-- Adds the two smallest Phase 3 schema gaps flagged in the reporting audit:
-- a salesperson on orders/invoices (for rep performance/commission
-- reporting) and lead-time/quality capture on purchasing (for a real
-- Supplier Performance Scorecard beyond spend ranking).
-- Additive only - existing rows get NULL/default values. Safe to re-run.

-- Salesperson is a user (there's no separate "employee" table in this
-- system - staff already are users), so this reuses the users table rather
-- than introducing a new one.
ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS salesperson_id INTEGER REFERENCES users(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS salesperson_id INTEGER REFERENCES users(id);

-- Expected delivery date, set on the PO - compared against when the
-- supplier's voucher actually landed to compute an on-time rate.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_date DATE;

-- Captured on the voucher (goods-received step): received_date defaults to
-- the voucher date for existing/simple flows, quality_rating records
-- whether what arrived was acceptable.
ALTER TABLE purchase_vouchers ADD COLUMN IF NOT EXISTS received_date DATE;
ALTER TABLE purchase_vouchers ADD COLUMN IF NOT EXISTS quality_rating VARCHAR(20) DEFAULT 'good';
-- good / minor_issues / rejected

UPDATE purchase_vouchers SET received_date = voucher_date WHERE received_date IS NULL;
