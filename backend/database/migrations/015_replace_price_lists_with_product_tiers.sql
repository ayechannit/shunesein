-- Replaces the Price Lists / Price List Items concept with a simpler,
-- product-first quantity-tier table: pick a product, define quantity
-- ranges and the price for each range - no price-list indirection, no
-- customer-type scoping. One set of tiers per product, applied for every
-- customer on both channels. Safe to re-run.

CREATE TABLE IF NOT EXISTS product_price_tiers (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    min_quantity DECIMAL(15,2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL,
    UNIQUE (product_id, min_quantity)
);
CREATE INDEX IF NOT EXISTS idx_product_price_tiers_product ON product_price_tiers(product_id);

-- Carry over any tiers already defined under the old price-list model,
-- before it's dropped below. Where the same product+quantity combination
-- existed on more than one price list, the most recently added row wins -
-- an unavoidable, acceptable loss of information when collapsing many
-- lists down to one tier set per product.
INSERT INTO product_price_tiers (product_id, min_quantity, unit_price)
SELECT DISTINCT ON (product_id, min_quantity) product_id, min_quantity, unit_price
FROM price_list_items
ORDER BY product_id, min_quantity, id DESC
ON CONFLICT (product_id, min_quantity) DO NOTHING;

-- Drop the columns that reference price_lists before the table itself,
-- otherwise the DROP TABLE below fails with a dependency error.
ALTER TABLE customers DROP COLUMN IF EXISTS price_list_id;
ALTER TABLE sales_invoices DROP COLUMN IF EXISTS price_list_id;

DROP TABLE IF EXISTS price_list_items;
DROP TABLE IF EXISTS price_lists;

UPDATE permissions SET description = 'Can manage product quantity-tier pricing' WHERE name = 'manage_price_lists';
