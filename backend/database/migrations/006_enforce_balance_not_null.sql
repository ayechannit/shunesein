-- Balance-like columns (suppliers.outstanding_balance, customers.outstanding_
-- balance/credit_limit, accounts.balance) had DEFAULT 0.00 but were not NOT
-- NULL, so any code path that explicitly inserts/updates NULL (e.g. a blank
-- cell in a CSV import) bypasses that default. A NULL balance is worse than
-- a wrong one: `balance = balance + $1` (payments, fund transfers, etc.)
-- stays NULL forever afterward, since NULL + anything is NULL in SQL.
-- Backfills any existing NULLs to 0 first, then locks the column down.
-- Safe to re-run.

UPDATE suppliers SET outstanding_balance = 0 WHERE outstanding_balance IS NULL;
UPDATE customers SET outstanding_balance = 0 WHERE outstanding_balance IS NULL;
UPDATE customers SET credit_limit = 0 WHERE credit_limit IS NULL;
UPDATE accounts SET balance = 0 WHERE balance IS NULL;

ALTER TABLE suppliers ALTER COLUMN outstanding_balance SET DEFAULT 0.00;
ALTER TABLE suppliers ALTER COLUMN outstanding_balance SET NOT NULL;

ALTER TABLE customers ALTER COLUMN outstanding_balance SET DEFAULT 0.00;
ALTER TABLE customers ALTER COLUMN outstanding_balance SET NOT NULL;
ALTER TABLE customers ALTER COLUMN credit_limit SET DEFAULT 0.00;
ALTER TABLE customers ALTER COLUMN credit_limit SET NOT NULL;

ALTER TABLE accounts ALTER COLUMN balance SET DEFAULT 0.00;
ALTER TABLE accounts ALTER COLUMN balance SET NOT NULL;
