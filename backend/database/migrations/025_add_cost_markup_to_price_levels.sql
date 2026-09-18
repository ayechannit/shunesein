-- Each price level gets its own cost price + markup (not just a flat
-- override price), matching the same Cost Price / Markup Type / Markup
-- Value / Selling Price shape as the product's own base pricing, so the
-- "Set Price" dialog can show one consistent table across every level.
-- `price` remains the calculated selling price for that level (what
-- pricingEngine.resolvePrice actually reads), kept in sync with cost/markup
-- by the application layer, same convention as products.selling_price.

ALTER TABLE product_price_by_level ADD COLUMN IF NOT EXISTS cost_price DECIMAL(15, 2);
ALTER TABLE product_price_by_level ADD COLUMN IF NOT EXISTS markup_type VARCHAR(20) DEFAULT 'fixed';
ALTER TABLE product_price_by_level ADD COLUMN IF NOT EXISTS markup_value DECIMAL(15, 2);
