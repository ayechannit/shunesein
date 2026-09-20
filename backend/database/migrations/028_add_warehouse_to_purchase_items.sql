-- Per-line warehouse on goods receipt (purchase voucher) items.
--
-- Until now, purchase_vouchers.warehouse_id forced every line of a receipt
-- into a single warehouse. A real goods receipt often splits one ordered
-- product across multiple warehouses on arrival (e.g. 3 units to the main
-- warehouse, 2 units to a branch warehouse) - that needs a warehouse per
-- item line, not one per voucher. Additive + backfilled. Safe to re-run.

ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id);

-- Backfill existing lines from their voucher's warehouse_id (their only
-- warehouse under the old model) before requiring the column going forward.
UPDATE purchase_items pi
SET warehouse_id = pv.warehouse_id
FROM purchase_vouchers pv
WHERE pi.voucher_id = pv.id AND pi.warehouse_id IS NULL;

ALTER TABLE purchase_items ALTER COLUMN warehouse_id SET NOT NULL;

-- purchase_vouchers.warehouse_id now serves only as the default warehouse
-- offered for new lines on the receipt form - each line's own warehouse_id
-- is the authoritative source for where stock actually landed.
COMMENT ON COLUMN purchase_vouchers.warehouse_id IS 'Default warehouse pre-filled on new receipt lines. Not authoritative for stock movement - see purchase_items.warehouse_id.';
COMMENT ON COLUMN purchase_items.warehouse_id IS 'Warehouse this line''s quantity was received into. Authoritative for stock movement.';
