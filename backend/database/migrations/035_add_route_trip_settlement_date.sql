-- The civil date a route trip's settlement is booked on, chosen by the
-- accountant. A van often returns after the office closes and is settled the
-- next morning, but the cash hand-in / shortage / stock variance belong to
-- the trip day - so this defaults to the trip date in the UI and is used for
-- every ledger, fund-transfer and staff-balance entry the settlement makes.
-- settled_at stays the real timestamp of when the button was pressed.
-- Safe to re-run.

ALTER TABLE route_trips ADD COLUMN IF NOT EXISTS settlement_date DATE;

UPDATE route_trips SET settlement_date = settled_at::date
WHERE status = 'settled' AND settlement_date IS NULL AND settled_at IS NOT NULL;
