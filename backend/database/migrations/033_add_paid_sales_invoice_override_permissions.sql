-- Lets chosen roles edit or delete a sales invoice that already has customer
-- receipts recorded against it. Without these, the normal rule stands:
--   * manage_sales_invoices_edit   -> only UNPAID invoices can be edited
--   * manage_sales_invoices_delete -> only invoices with NO payments can be deleted
--
-- manage_sales_invoices_edit_paid: edit a partial/paid invoice at any time.
--   Payments are kept; payment_status is recomputed against the new total
--   (if the new total drops below what was received, the extra stays as a
--   customer credit, i.e. a negative outstanding_balance).
-- manage_sales_invoices_delete_paid: delete an invoice with payments at any
--   time. Its receipts are deleted too, fully reversed exactly like deleting
--   a payment by hand (account balance + journal) - see SalesController.
--
-- Only the Owner role gets them automatically; grant to other roles from
-- Roles > Permissions. Safe to re-run.

INSERT INTO permissions (name, module, description) VALUES
    ('manage_sales_invoices_edit_paid', 'Sales', 'Can edit sales invoices that already have payments (paid or partially paid)'),
    ('manage_sales_invoices_delete_paid', 'Sales', 'Can delete sales invoices that already have payments (the payments are deleted and reversed too)')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('manage_sales_invoices_edit_paid', 'manage_sales_invoices_delete_paid')
WHERE r.name = 'Owner'
ON CONFLICT DO NOTHING;
