-- Goods Receipt/Return required a PO (po_id NOT NULL) - but not every
-- purchase has one. A "direct voucher" (purchase_vouchers.po_id IS NULL,
-- billed with no PO at all) is common in this dataset (5 of 8 existing
-- vouchers). Under the new billing-only Voucher model, those purchases had
-- no way to ever move stock, since only Goods Receipt does that now.
--
-- This adds an alternate parent: a Goods Receipt/Return can attach to
-- EITHER a PO or a Voucher (never both, never neither) - the Voucher path
-- caps received/returned quantity against the Voucher's own billed line
-- items (purchase_items) instead of a PO's ordered ones
-- (purchase_order_items), same pattern, different source of "how much was
-- this for".
--
-- Safe to re-run.

ALTER TABLE goods_receipts ALTER COLUMN po_id DROP NOT NULL;
ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS voucher_id INTEGER REFERENCES purchase_vouchers(id);
ALTER TABLE goods_receipts DROP CONSTRAINT IF EXISTS goods_receipts_one_parent;
ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_one_parent
    CHECK ((po_id IS NOT NULL)::int + (voucher_id IS NOT NULL)::int = 1);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_voucher_id ON goods_receipts(voucher_id);

ALTER TABLE goods_receipt_items ALTER COLUMN po_item_id DROP NOT NULL;
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS voucher_item_id INTEGER REFERENCES purchase_items(id);
ALTER TABLE goods_receipt_items DROP CONSTRAINT IF EXISTS goods_receipt_items_one_parent;
ALTER TABLE goods_receipt_items ADD CONSTRAINT goods_receipt_items_one_parent
    CHECK ((po_item_id IS NOT NULL)::int + (voucher_item_id IS NOT NULL)::int = 1);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_voucher_item_id ON goods_receipt_items(voucher_item_id);

ALTER TABLE goods_returns ALTER COLUMN po_id DROP NOT NULL;
ALTER TABLE goods_returns ADD COLUMN IF NOT EXISTS voucher_id INTEGER REFERENCES purchase_vouchers(id);
ALTER TABLE goods_returns DROP CONSTRAINT IF EXISTS goods_returns_one_parent;
ALTER TABLE goods_returns ADD CONSTRAINT goods_returns_one_parent
    CHECK ((po_id IS NOT NULL)::int + (voucher_id IS NOT NULL)::int = 1);
CREATE INDEX IF NOT EXISTS idx_goods_returns_voucher_id ON goods_returns(voucher_id);

ALTER TABLE goods_return_items ALTER COLUMN po_item_id DROP NOT NULL;
ALTER TABLE goods_return_items ADD COLUMN IF NOT EXISTS voucher_item_id INTEGER REFERENCES purchase_items(id);
ALTER TABLE goods_return_items DROP CONSTRAINT IF EXISTS goods_return_items_one_parent;
ALTER TABLE goods_return_items ADD CONSTRAINT goods_return_items_one_parent
    CHECK ((po_item_id IS NOT NULL)::int + (voucher_item_id IS NOT NULL)::int = 1);
CREATE INDEX IF NOT EXISTS idx_goods_return_items_voucher_item_id ON goods_return_items(voucher_item_id);
