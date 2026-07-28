-- Expands RBAC from 5 coarse permissions to one per module, and wires them up
-- to routes (see src/routes/*.js + src/utils/permissions.js).
-- Safe to re-run: every insert is guarded with ON CONFLICT DO NOTHING.

-- ==========================================
-- 1. New permissions
-- ==========================================

INSERT INTO permissions (name, module, description) VALUES
    ('manage_roles', 'User Management', 'Can create/edit roles and assign permissions to them'),
    ('manage_master_data', 'Master Data', 'Can create, edit and delete categories, products, suppliers, customers, warehouses, accounts and payment methods'),
    ('manage_procurement', 'Procurement', 'Can create, edit, approve, cancel and delete purchase orders and vouchers'),
    ('manage_payments', 'Payments', 'Can record customer receipts and supplier payments'),
    ('manage_finance', 'Finance', 'Can manage cash/bank accounts and income & expense entries'),
    ('manage_delivery', 'Delivery', 'Can create and update deliveries'),
    ('manage_settings', 'System Settings', 'Can view and update global system settings'),
    ('view_audit_log', 'Audit Log', 'Can view the system activity/audit trail')
ON CONFLICT (name) DO NOTHING;

-- ==========================================
-- 2. Owner keeps full access (matches the original seeds.sql intent)
-- ==========================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Owner'
ON CONFLICT DO NOTHING;

-- ==========================================
-- 3. Proposed mapping for the other seeded roles.
--    Review this against your actual staff responsibilities before relying on it --
--    it is a reasonable starting point, not a business rule confirmed by the client.
-- ==========================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Manager' AND p.name IN (
    'manage_users', 'manage_master_data', 'manage_procurement', 'process_sales',
    'manage_stock', 'manage_production', 'manage_delivery', 'manage_payments',
    'manage_finance', 'view_reports', 'view_audit_log'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Accountant' AND p.name IN (
    'view_reports', 'manage_finance', 'manage_payments', 'view_audit_log'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Warehouse Staff' AND p.name IN (
    'manage_stock', 'manage_procurement', 'manage_delivery'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Production Staff' AND p.name IN (
    'manage_production', 'manage_stock'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Sales Staff' AND p.name IN (
    'process_sales', 'manage_delivery', 'manage_payments', 'manage_master_data'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Cashier' AND p.name IN (
    'manage_payments', 'process_sales'
)
ON CONFLICT DO NOTHING;
