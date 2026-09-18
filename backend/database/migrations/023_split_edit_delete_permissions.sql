-- Splits every transaction module's single "manage_x" permission (which has
-- always covered create + edit + delete + status-change together) into a
-- dedicated manage_x_edit and manage_x_delete permission, so a role can be
-- allowed to edit a record without also being allowed to delete it (or vice
-- versa). The base manage_x permission is kept as-is and continues to gate
-- create (and status-advance actions that have no separate lifecycle risk).
-- Mirrors the exact pattern migration 019 used to split module permissions
-- into items. Safe to re-run: every insert is guarded with ON CONFLICT DO
-- NOTHING.

-- ==========================================
-- 1. New edit/delete permissions
-- ==========================================

INSERT INTO permissions (name, module, description) VALUES
    ('manage_sale_orders_edit', 'Sales', 'Can edit pending sale orders'),
    ('manage_sale_orders_delete', 'Sales', 'Can delete pending sale orders'),
    ('manage_sales_invoices_edit', 'Sales', 'Can edit unpaid sales invoices'),
    ('manage_sales_invoices_delete', 'Sales', 'Can delete sales invoices with no recorded payments'),
    ('manage_sales_returns_edit', 'Sales', 'Can edit sales returns / credit notes'),
    ('manage_sales_returns_delete', 'Sales', 'Can delete sales returns / credit notes'),
    ('manage_purchase_orders_edit', 'Procurement', 'Can edit pending purchase orders'),
    ('manage_purchase_orders_delete', 'Procurement', 'Can delete pending purchase orders'),
    ('manage_purchase_vouchers_edit', 'Procurement', 'Can edit unpaid purchase vouchers'),
    ('manage_purchase_vouchers_delete', 'Procurement', 'Can delete purchase vouchers with no recorded payments'),
    ('manage_purchase_returns_edit', 'Procurement', 'Can edit purchase returns / debit notes'),
    ('manage_purchase_returns_delete', 'Procurement', 'Can delete purchase returns / debit notes'),
    ('manage_production_edit', 'Inventory', 'Can edit pending production batches'),
    ('manage_production_delete', 'Inventory', 'Can delete pending production batches'),
    ('manage_stock_edit', 'Inventory', 'Can edit pending/approved stock transfers and stock adjustments'),
    ('manage_stock_delete', 'Inventory', 'Can delete pending/approved stock transfers and stock adjustments'),
    ('manage_finance_entries_edit', 'Finance', 'Can edit income/expense entries'),
    ('manage_finance_entries_delete', 'Finance', 'Can delete income/expense entries'),
    ('manage_finance_transfers_edit', 'Finance', 'Can edit fund transfers'),
    ('manage_finance_transfers_delete', 'Finance', 'Can delete fund transfers'),
    ('manage_payments_edit', 'Finance', 'Can edit recorded customer receipts / supplier payments'),
    ('manage_payments_delete', 'Finance', 'Can delete recorded customer receipts / supplier payments'),
    ('manage_delivery_edit', 'Sales', 'Can edit pending deliveries'),
    ('manage_delivery_delete', 'Sales', 'Can delete pending deliveries')
ON CONFLICT (name) DO NOTHING;

-- ==========================================
-- 2. Auto-grant: every role that currently holds the base manage_x
--    permission gets both new manage_x_edit / manage_x_delete permissions,
--    so nobody's access changes as a direct result of this split.
-- ==========================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_sale_orders_edit', 'manage_sale_orders_delete')
WHERE old_p.name = 'manage_sale_orders'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_sales_invoices_edit', 'manage_sales_invoices_delete')
WHERE old_p.name = 'manage_sales_invoices'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_sales_returns_edit', 'manage_sales_returns_delete')
WHERE old_p.name = 'manage_sales_returns'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_purchase_orders_edit', 'manage_purchase_orders_delete')
WHERE old_p.name = 'manage_purchase_orders'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_purchase_vouchers_edit', 'manage_purchase_vouchers_delete')
WHERE old_p.name = 'manage_purchase_vouchers'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_purchase_returns_edit', 'manage_purchase_returns_delete')
WHERE old_p.name = 'manage_purchase_returns'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_production_edit', 'manage_production_delete')
WHERE old_p.name = 'manage_production'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_stock_edit', 'manage_stock_delete')
WHERE old_p.name = 'manage_stock'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_finance_entries_edit', 'manage_finance_entries_delete')
WHERE old_p.name = 'manage_finance_entries'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_finance_transfers_edit', 'manage_finance_transfers_delete')
WHERE old_p.name = 'manage_finance_transfers'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_payments_edit', 'manage_payments_delete')
WHERE old_p.name = 'manage_payments'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_delivery_edit', 'manage_delivery_delete')
WHERE old_p.name = 'manage_delivery'
ON CONFLICT DO NOTHING;
