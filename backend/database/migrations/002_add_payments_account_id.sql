-- payments.account_id was accepted by the API and used to adjust accounts.balance,
-- but was never persisted, and PaymentController.getAll joined accounts on the
-- wrong column (p.id = a.id) as a result. This adds the missing column so the
-- join can be corrected and payment history can show which account was used.
-- Safe to re-run.

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id);
