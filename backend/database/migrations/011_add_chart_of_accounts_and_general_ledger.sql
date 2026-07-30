-- Chart of Accounts / General Ledger - the last Phase 3 item, and the
-- largest: enables a real Trial Balance and Balance Sheet, which the
-- reporting audit flagged as impossible under the old flat cash/bank +
-- income/expense model.
--
-- Design choice: this is a SHADOW ledger, additive to the existing system,
-- not a replacement for it. accounts.balance, customers/suppliers.
-- outstanding_balance, and stock_levels remain the authoritative figures
-- everywhere else in the app, computed exactly as before - the GL is a
-- second, independent bookkeeping trail fed by the same business events.
-- See src/utils/journalPoster.js: if GL posting ever fails, or this
-- migration hasn't been run yet, every existing sale/purchase/payment/
-- expense flow keeps working exactly as before - the GL can be wrong or
-- absent without breaking the operational system that predates it.
--
-- A FIXED, small set of system accounts is used rather than one GL account
-- per cash/bank account or per income/expense category - so a new bank
-- account or a new expense category added after this migration runs never
-- needs a matching GL link to keep working. This trades per-account/
-- per-category GL granularity (still available from the existing Cash &
-- Bank and Income & Expense reports) for a design that can't be broken by
-- ordinary master-data changes made later.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    account_type VARCHAR(20) NOT NULL, -- asset, liability, equity, income, expense
    normal_balance VARCHAR(10) NOT NULL, -- debit, credit
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id SERIAL PRIMARY KEY,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference_type VARCHAR(30) NOT NULL,
    reference_id INTEGER,
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id SERIAL PRIMARY KEY,
    journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
    debit DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    credit DECIMAL(15, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reference ON journal_entries(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines(account_id);

INSERT INTO chart_of_accounts (code, name, account_type, normal_balance) VALUES
    ('1000', 'Cash & Bank', 'asset', 'debit'),
    ('1100', 'Accounts Receivable', 'asset', 'debit'),
    ('1200', 'Inventory', 'asset', 'debit'),
    ('2000', 'Accounts Payable', 'liability', 'credit'),
    ('2100', 'Sales Tax Payable', 'liability', 'credit'),
    ('3000', 'Owner''s Equity', 'equity', 'credit'),
    ('4000', 'Sales Revenue', 'income', 'credit'),
    ('4900', 'Other Income', 'income', 'credit'),
    ('5000', 'Cost of Goods Sold', 'expense', 'debit'),
    ('5900', 'Operating Expenses', 'expense', 'debit')
ON CONFLICT (code) DO NOTHING;

-- One-time opening-balance snapshot, so the Trial Balance/Balance Sheet
-- reflect where the business actually stands today rather than starting at
-- zero while real cash/AR/AP/inventory are already nonzero. Guarded to run
-- only once (no prior 'opening_balance' entry) - safe to re-run this file.
-- Purchase tax is folded into Inventory cost (treated as non-recoverable)
-- rather than a separate input-tax asset - see journalPoster.js for the
-- same convention applied to every purchase voucher going forward.
DO $$
DECLARE
    v_cash DECIMAL(15,2);
    v_ar DECIMAL(15,2);
    v_ap DECIMAL(15,2);
    v_inventory DECIMAL(15,2);
    v_plug DECIMAL(15,2);
    v_entry_id INTEGER;
    v_cash_acct INTEGER;
    v_ar_acct INTEGER;
    v_ap_acct INTEGER;
    v_inv_acct INTEGER;
    v_equity_acct INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference_type = 'opening_balance') THEN
        SELECT COALESCE(SUM(balance), 0) INTO v_cash FROM accounts;
        SELECT COALESCE(SUM(outstanding_balance), 0) INTO v_ar FROM customers;
        SELECT COALESCE(SUM(outstanding_balance), 0) INTO v_ap FROM suppliers;
        SELECT COALESCE(SUM(sl.quantity * p.cost_price), 0) INTO v_inventory
            FROM stock_levels sl JOIN products p ON sl.product_id = p.id;

        v_plug := v_cash + v_ar + v_inventory - v_ap;

        SELECT id INTO v_cash_acct FROM chart_of_accounts WHERE code = '1000';
        SELECT id INTO v_ar_acct FROM chart_of_accounts WHERE code = '1100';
        SELECT id INTO v_ap_acct FROM chart_of_accounts WHERE code = '2000';
        SELECT id INTO v_inv_acct FROM chart_of_accounts WHERE code = '1200';
        SELECT id INTO v_equity_acct FROM chart_of_accounts WHERE code = '3000';

        INSERT INTO journal_entries (entry_date, reference_type, reference_id, description)
        VALUES (CURRENT_DATE, 'opening_balance', NULL, 'Opening balance snapshot at General Ledger setup')
        RETURNING id INTO v_entry_id;

        IF v_cash <> 0 THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
            VALUES (v_entry_id, v_cash_acct, GREATEST(v_cash, 0), GREATEST(-v_cash, 0));
        END IF;
        IF v_ar <> 0 THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
            VALUES (v_entry_id, v_ar_acct, GREATEST(v_ar, 0), GREATEST(-v_ar, 0));
        END IF;
        IF v_inventory <> 0 THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
            VALUES (v_entry_id, v_inv_acct, GREATEST(v_inventory, 0), GREATEST(-v_inventory, 0));
        END IF;
        IF v_ap <> 0 THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
            VALUES (v_entry_id, v_ap_acct, GREATEST(-v_ap, 0), GREATEST(v_ap, 0));
        END IF;
        IF v_plug <> 0 THEN
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
            VALUES (v_entry_id, v_equity_acct, GREATEST(-v_plug, 0), GREATEST(v_plug, 0));
        END IF;
    END IF;
END $$;
