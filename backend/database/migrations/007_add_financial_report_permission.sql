-- Splits reporting access into operational vs. financial: the original
-- view_reports permission covered everything from a stock count to the P&L.
-- Financially sensitive reports (P&L, margins, statements of account, tax,
-- expenses, outstanding) now also require view_financial_reports; purely
-- operational reports (stock, movement, production, order backlogs) keep
-- requiring only view_reports. See src/routes/reportRoutes.js.
-- Safe to re-run: every insert is guarded with ON CONFLICT DO NOTHING.

INSERT INTO permissions (name, module, description) VALUES
    ('view_financial_reports', 'Reports', 'Can view financially sensitive reports (P&L, margins, statements of account, tax, expenses, outstanding balances)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Owner' AND p.name = 'view_financial_reports'
ON CONFLICT DO NOTHING;

-- Matches the existing Manager/Accountant grant of view_reports in
-- 001_expand_rbac_permissions.sql - both already see everything reports
-- covered before this split.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('Manager', 'Accountant') AND p.name = 'view_financial_reports'
ON CONFLICT DO NOTHING;
