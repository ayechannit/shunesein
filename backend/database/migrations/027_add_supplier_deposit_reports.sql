-- Adds reporting support for supplier deposits (migration 026):
-- 1. A dedicated Supplier Deposit Register report (see ReportController.
--    getSupplierDepositRegister), mirroring the existing Fund Transfer
--    Register - a read-only audit list, separate from the Procurement >
--    Supplier Deposits management screen, so a report-only viewer (e.g.
--    Accountant) can see it without also holding manage_supplier_deposits.
-- 2. getOutstanding and getCashFlowStatement were updated in code to account
--    for deposits correctly (no new permissions needed for those - they
--    reuse view_report_outstanding / view_report_cash_flow).
--
-- Safe to re-run.

INSERT INTO permissions (name, module, description) VALUES
    ('view_report_supplier_deposit_register', 'Reports', 'Can view the Supplier Deposit Register report')
ON CONFLICT (name) DO NOTHING;

-- Auto-grant: every role that currently holds view_report_fund_transfer_register
-- (the equivalent register report for the other money-movement type) gets
-- this one too, so nobody's access changes as a direct result of adding it.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name = 'view_report_supplier_deposit_register'
WHERE old_p.name = 'view_report_fund_transfer_register'
ON CONFLICT DO NOTHING;
