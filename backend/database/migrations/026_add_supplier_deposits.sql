-- Supplier deposits: advance payments made to a supplier before any goods
-- are received against them. Kept as its own table (not folded into
-- suppliers.outstanding_balance, which tracks what we owe for RECEIVED
-- goods) so each deposit's remaining balance can be tracked independently
-- and optionally drawn down later.
--
-- A deposit is "spent" the same way a purchase voucher's payment_status is
-- computed - via SUM(payments.amount) - by reusing the existing payments
-- table with a new nullable deposit_id column, rather than a second parallel
-- ledger. See PaymentController.create: when deposit_id is set on a
-- purchase payment, no cash/bank account moves - the payment amount is
-- drawn from the deposit's remaining balance instead. This is what lets a
-- purchase voucher's payment optionally reduce a deposit instead of cash,
-- exactly like an ordinary payment in every other respect (payment_status,
-- supplier outstanding_balance, and the GL all update the same way).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS supplier_deposits (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    deposit_date DATE DEFAULT CURRENT_DATE,
    amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
    payment_method_id INTEGER REFERENCES payment_methods(id),
    account_id INTEGER REFERENCES accounts(id),
    reference_no VARCHAR(100),
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_deposits_supplier_id ON supplier_deposits(supplier_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS deposit_id INTEGER REFERENCES supplier_deposits(id);
CREATE INDEX IF NOT EXISTS idx_payments_deposit_id ON payments(deposit_id) WHERE deposit_id IS NOT NULL;

-- New system account: money already paid to suppliers in advance is an
-- asset (they owe us goods, or a refund), distinct from Cash & Bank and
-- from Accounts Payable. See journalPoster.js ACCOUNT_CODES.SUPPLIER_DEPOSITS.
INSERT INTO chart_of_accounts (code, name, account_type, normal_balance) VALUES
    ('1300', 'Advance to Suppliers', 'asset', 'debit')
ON CONFLICT (code) DO NOTHING;

-- Fixed payment method used only to label a payment that was funded from a
-- deposit rather than a real cash/bank movement. PaymentController.create
-- forces this method whenever deposit_id is set, regardless of what the
-- client sends, so deposit-funded payments always show consistently in
-- payment history (mirrors how migration 014 seeded the fixed 'CASH' method).
--
-- MasterDataController.js has always listed 'description' as a
-- payment_methods column, but this environment's table predates it and
-- never got the column - add it defensively (same convention as migration
-- 002 backfilling payments.account_id) so this insert and the Payment
-- Methods master-data screen both work.
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS description TEXT;

INSERT INTO payment_methods (code, name, description) VALUES
    ('SUPPLIER_DEPOSIT', 'Supplier Deposit', 'System method used when a purchase payment is drawn from a supplier deposit balance rather than cash/bank')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (name, module, description) VALUES
    ('manage_supplier_deposits', 'Procurement', 'Can record advance deposit payments to suppliers'),
    ('manage_supplier_deposits_delete', 'Procurement', 'Can delete unused supplier deposits')
ON CONFLICT (name) DO NOTHING;

-- Auto-grant: every role that currently holds manage_payments (already
-- records supplier payments) gets the new deposit permissions too, so
-- nobody's access changes as a direct result of adding this feature.
-- Same convention as migration 023's edit/delete split.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, new_p.id
FROM role_permissions rp
JOIN permissions old_p ON old_p.id = rp.permission_id
JOIN permissions new_p ON new_p.name IN ('manage_supplier_deposits', 'manage_supplier_deposits_delete')
WHERE old_p.name = 'manage_payments'
ON CONFLICT DO NOTHING;
