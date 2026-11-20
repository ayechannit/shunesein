-- "Needs delivery" on sale orders and sales invoices, with where to deliver.
--
-- needs_delivery: ticked when the goods must be delivered to the customer
--   (unticked = walk-in / customer collects). Existing rows default to false,
--   so old invoices count as "no delivery" and do not show up in the New
--   Delivery picker.
-- delivery_address / delivery_phone: filled in from the customer's saved
--   address and phone when the box is ticked, editable per order/invoice.
--   Editing them never changes the customer record. Address is required
--   (enforced in SalesController) when needs_delivery is true.
-- An invoice made from a sale order copies all three from the order.

ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS needs_delivery BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS delivery_phone VARCHAR(50);

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS needs_delivery BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_phone VARCHAR(50);

-- The New Delivery picker lists only invoices that need delivery.
CREATE INDEX IF NOT EXISTS idx_sales_invoices_needs_delivery
  ON sales_invoices (id) WHERE needs_delivery;
