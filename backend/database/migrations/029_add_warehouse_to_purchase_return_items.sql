-- Per-line warehouse on purchase return items - same reasoning as
-- migrations/028_add_warehouse_to_purchase_items.sql. A return can send
-- units back to the supplier from more than one warehouse (e.g. some of a
-- product was received into two warehouses on the original voucher and both
-- portions are being returned), so the warehouse needs to live on the line,
-- not only on the return header. Additive + backfilled. Safe to re-run.

ALTER TABLE purchase_return_items ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id);

-- Backfill existing lines from their return's warehouse_id (their only
-- warehouse under the old model) before requiring the column going forward.
UPDATE purchase_return_items pri
SET warehouse_id = pr.warehouse_id
FROM purchase_returns pr
WHERE pri.return_id = pr.id AND pri.warehouse_id IS NULL;

ALTER TABLE purchase_return_items ALTER COLUMN warehouse_id SET NOT NULL;

COMMENT ON COLUMN purchase_returns.warehouse_id IS 'Default warehouse pre-filled on new return lines. Not authoritative for stock movement - see purchase_return_items.warehouse_id.';
COMMENT ON COLUMN purchase_return_items.warehouse_id IS 'Warehouse this line''s quantity was returned from. Authoritative for stock movement.';
