-- Every stock-deducting code path already checks availability in the
-- application layer before decrementing (sales, purchase returns, transfers,
-- adjustments, production) - but that's the only line of defense today. This
-- adds a database-level backstop so a bug in any single call site (missed a
-- check, wrong warehouse_id, a future write path that forgets the guard)
-- can't silently push a product's stock negative; it fails loudly at the DB
-- instead. Confirmed no existing row violates this before adding it.
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so this checks pg_constraint
-- directly to stay idempotent/safe to re-run like every other migration here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_stock_levels_quantity_non_negative'
  ) THEN
    ALTER TABLE stock_levels
      ADD CONSTRAINT chk_stock_levels_quantity_non_negative CHECK (quantity >= 0);
  END IF;
END $$;
