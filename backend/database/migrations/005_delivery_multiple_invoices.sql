-- A delivery (one truck run) can now cover multiple sales invoices instead of
-- exactly one. Replaces deliveries.invoice_id (single FK) with a junction
-- table. Safe to re-run.

CREATE TABLE IF NOT EXISTS delivery_invoices (
    id SERIAL PRIMARY KEY,
    delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id),
    UNIQUE (delivery_id, invoice_id)
);

-- Backfill any deliveries created under the old single-invoice model.
INSERT INTO delivery_invoices (delivery_id, invoice_id)
SELECT id, invoice_id FROM deliveries WHERE invoice_id IS NOT NULL
ON CONFLICT (delivery_id, invoice_id) DO NOTHING;

ALTER TABLE deliveries DROP COLUMN IF EXISTS invoice_id;
