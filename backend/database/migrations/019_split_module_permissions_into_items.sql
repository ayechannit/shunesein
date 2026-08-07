-- Splits 4 coarse "one permission per module" rows into one permission per
-- item within that module, so a role can be given (e.g.) Products without
-- also getting Suppliers/Accounts/etc. Mirrors the actual page-level split
-- already wired up in src/routes/*.js (see permissions.js for the new
-- constants). Safe to re-run: every insert is guarded with ON CONFLICT DO
-- NOTHING and the final DELETE is a no-op once the old rows are gone.

-- ==========================================
-- 1. New per-item permissions
-- ==========================================

INSERT INTO permissions (name, module, description) VALUES
    ('manage_categories', 'Master Data', 'Can create, edit and delete categories'),
    ('manage_products', 'Master Data', 'Can create, edit and delete products'),
    ('manage_suppliers', 'Master Data', 'Can create, edit and delete suppliers'),
    ('manage_customers', 'Master Data', 'Can create, edit and delete customers'),
    ('manage_warehouses', 'Master Data', 'Can create, edit and delete warehouses'),
    ('manage_accounts', 'Master Data', 'Can create, edit and delete cash/bank accounts'),
    ('manage_payment_methods', 'Master Data', 'Can create, edit and delete payment methods'),
    ('manage_purchase_orders', 'Procurement', 'Can create, edit, approve, cancel and delete purchase orders'),
    ('manage_purchase_vouchers', 'Procurement', 'Can create, edit and delete purchase vouchers'),
    ('manage_purchase_returns', 'Procurement', 'Can create and delete purchase returns / debit notes'),
    ('manage_sale_orders', 'Sales', 'Can create, edit, approve, cancel and delete sale orders'),
    ('manage_sales_invoices', 'Sales', 'Can create, edit and delete sales invoices'),
    ('manage_sales_returns', 'Sales', 'Can create and delete sales returns / credit notes'),
    ('manage_finance_categories', 'Finance', 'Can create, edit and delete income/expense categories'),
    ('manage_finance_entries', 'Finance', 'Can record and delete income/expense entries'),
    ('manage_finance_transfers', 'Finance', 'Can record and delete fund transfers between accounts')
ON CONFLICT (name) DO NOTHING;

-- ==========================================
-- 2. Auto-grant equivalents: every role that currently holds one of the old
--    coarse permissions gets every new item permission that replaces it, so
--    nobody's access changes as a direct result of this split. Driven off
--    the live role_permissions table (not the original seed mapping), so it
--    reflects whatever roles actually have today, however they got there.
-- ==========================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN (
    'manage_categories', 'manage_products', 'manage_suppliers', 'manage_customers',
    'manage_warehouses', 'manage_accounts', 'manage_payment_methods'
)
WHERE old_p.name = 'manage_master_data'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN (
    'manage_purchase_orders', 'manage_purchase_vouchers', 'manage_purchase_returns'
)
WHERE old_p.name = 'manage_procurement'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN (
    'manage_sale_orders', 'manage_sales_invoices', 'manage_sales_returns'
)
WHERE old_p.name = 'process_sales'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN (
    'manage_finance_categories', 'manage_finance_entries', 'manage_finance_transfers'
)
WHERE old_p.name = 'manage_finance'
ON CONFLICT DO NOTHING;

-- ==========================================
-- 3. The old coarse permissions no longer gate any route (see
--    src/routes/masterRoutes.js, procurementRoutes.js, salesRoutes.js,
--    financeRoutes.js) - remove them. role_permissions rows referencing
--    them cascade-delete automatically.
-- ==========================================

DELETE FROM permissions WHERE name IN ('manage_master_data', 'manage_procurement', 'process_sales', 'manage_finance');
