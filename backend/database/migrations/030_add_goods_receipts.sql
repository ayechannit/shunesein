-- Goods Receipt Notes (GRN): decouples the physical act of receiving stock
-- from the Purchase Voucher (which, until now, secretly did both - it moved
-- stock AND created the supplier bill in one atomic action, with no way to
-- receive a single PO's goods across multiple deliveries).
--
-- Going forward:
--   - Purchase Order: stays stock-neutral (unchanged).
--   - Goods Receipt: the ONLY thing that moves stock_levels/stock_transactions
--     for procurement. Tied to exactly one approved (or partially-received)
--     PO, and can be created multiple times against the same PO - each time
--     for whatever quantity actually arrived, split across warehouse(s)
--     using the same per-line pattern purchase_items/purchase_return_items
--     already use.
--   - Purchase Voucher: becomes billing-only (see PurchaseController.js -
--     createVoucher/updateVoucher/deleteVoucher no longer touch stock).
--
-- received_qty per PO line is computed on the fly (SUM over
-- goods_receipt_items), not stored redundantly - same style as
-- getAllVouchers' existing total_returned subquery.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS goods_receipts (
    id SERIAL PRIMARY KEY,
    receipt_number VARCHAR(50) UNIQUE NOT NULL,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    receipt_date DATE DEFAULT CURRENT_DATE,
    quality_rating VARCHAR(20) DEFAULT 'good',
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_id ON goods_receipts(po_id);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id SERIAL PRIMARY KEY,
    receipt_id INTEGER REFERENCES goods_receipts(id) ON DELETE CASCADE,
    po_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id),
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15,2) NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    lot_number VARCHAR(50),
    expiry_date DATE
);

CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_po_item_id ON goods_receipt_items(po_item_id);

-- purchase_items.warehouse_id (added in migration 028) is no longer
-- collected on the voucher form - receiving now owns warehouse/lot/expiry.
-- Column stays for historical rows already recorded; just no longer
-- required going forward.
ALTER TABLE purchase_items ALTER COLUMN warehouse_id DROP NOT NULL;
COMMENT ON COLUMN purchase_items.warehouse_id IS 'Deprecated - no longer collected on new vouchers. Physical receiving now lives on goods_receipt_items.warehouse_id.';

INSERT INTO permissions (name, module, description) VALUES
    ('manage_goods_receipts', 'Procurement', 'Can record goods received against an approved purchase order'),
    ('manage_goods_receipts_delete', 'Procurement', 'Can delete goods receipts whose stock has not already moved on')
ON CONFLICT (name) DO NOTHING;

-- Auto-grant: every role that currently holds manage_purchase_vouchers
-- (previously the permission that implicitly let you receive goods, since
-- creating a voucher was what moved stock) gets the new receiving
-- permissions too, so nobody's access changes as a direct result of this split.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_goods_receipts', 'manage_goods_receipts_delete')
WHERE old_p.name = 'manage_purchase_vouchers'
ON CONFLICT DO NOTHING;
