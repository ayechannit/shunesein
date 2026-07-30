-- Batch/lot and expiry tracking - the highest food-safety-relevant gap
-- flagged in the reporting audit for a tea/fried-bean manufacturer.
--
-- Scope note: this captures lot_number/expiry_date at the two points stock
-- enters the system (goods received on a purchase voucher, finished goods
-- produced on a batch) and reports on it. It deliberately does NOT turn
-- stock_levels itself into a per-lot ledger - sales, transfers, and
-- adjustments still deduct from the aggregate quantity, not a specific lot.
-- Doing that properly (FEFO-aware picking) would mean re-plumbing every
-- stock-deducting workflow to choose a lot, which is a much larger change
-- than this pass covers. What this DOES give: a real "what's expiring soon"
-- early-warning report based on what was actually received/produced -
-- useful today, honestly scoped, and a foundation the FEFO work could build on.
-- Additive only. Safe to re-run.

ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS lot_number VARCHAR(50);
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS expiry_date DATE;

ALTER TABLE production_finished_goods ADD COLUMN IF NOT EXISTS lot_number VARCHAR(50);
ALTER TABLE production_finished_goods ADD COLUMN IF NOT EXISTS expiry_date DATE;
