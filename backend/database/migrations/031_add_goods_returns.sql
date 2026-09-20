-- Goods Returns: replaces Purchase Returns' voucher-based linkage with the
-- same PO-item-referencing pattern Goods Receipts use (migration 030). A
-- return is capped per line at (received so far - already returned so far),
-- not the original order quantity - you can only send back what's actually
-- in hand, and "in hand" is now tracked via goods_receipt_items, not a
-- voucher (which no longer carries any stock/warehouse information).
--
-- purchase_returns/purchase_return_items (voucher-based, from before Goods
-- Receipt existed) are left in place untouched for historical data - not
-- migrated or dropped, just no longer linked from the nav going forward.
--
-- unit_price/subtotal on goods_return_items are captured from the PO item
-- at return time (a historical snapshot, same convention
-- purchase_return_items.subtotal already uses) rather than re-entered by
-- the user - the PO already knows what was paid per unit.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS goods_returns (
    id SERIAL PRIMARY KEY,
    return_number VARCHAR(50) UNIQUE NOT NULL,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    return_date DATE DEFAULT CURRENT_DATE,
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_goods_returns_po_id ON goods_returns(po_id);

CREATE TABLE IF NOT EXISTS goods_return_items (
    id SERIAL PRIMARY KEY,
    return_id INTEGER REFERENCES goods_returns(id) ON DELETE CASCADE,
    po_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id),
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    subtotal DECIMAL(15,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE INDEX IF NOT EXISTS idx_goods_return_items_po_item_id ON goods_return_items(po_item_id);

INSERT INTO permissions (name, module, description) VALUES
    ('manage_goods_returns', 'Procurement', 'Can send received goods back to a supplier against a purchase order'),
    ('manage_goods_returns_delete', 'Procurement', 'Can delete goods returns whose stock has not already moved on')
ON CONFLICT (name) DO NOTHING;

-- Auto-grant: every role that currently holds manage_purchase_returns gets
-- the new goods-return permissions too, so nobody's access changes as a
-- direct result of this split.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_goods_returns', 'manage_goods_returns_delete')
WHERE old_p.name = 'manage_purchase_returns'
ON CONFLICT DO NOTHING;
