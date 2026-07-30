-- Shared foundation for the Wholesale and Retail (POS) modules - price
-- lists, a proper tax-rate model, payment terms, and the channel dimension
-- that makes every existing report channel-aware for free. See the design
-- document for the full rationale. Additive only. Safe to re-run.

-- ==========================================
-- Tax rates - replaces the manually-typed flat invoice-level tax_amount
-- with a per-product rate the application computes from. Shared by
-- Wholesale, Retail, and Purchasing alike; not specific to either new module.
-- ==========================================
CREATE TABLE IF NOT EXISTS tax_rates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rate_percent DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tax_rates (name, rate_percent) VALUES ('Standard', 0.00) ON CONFLICT DO NOTHING;

ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_rate_id INTEGER REFERENCES tax_rates(id);

-- ==========================================
-- Price Lists - one pricing engine, shared by both channels. A list scoped
-- to a customer_type is the default for that segment; a customer can also
-- be assigned a specific list directly (a negotiated wholesale contract, or
-- a specific store's retail list).
-- ==========================================
CREATE TABLE IF NOT EXISTS price_lists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    customer_type_scope VARCHAR(50), -- Distributor / Wholesaler / Retail / Individual / NULL (any)
    tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
    valid_from DATE,
    valid_to DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_list_items (
    id SERIAL PRIMARY KEY,
    price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    min_quantity DECIMAL(15, 2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_lookup ON price_list_items(price_list_id, product_id, min_quantity);

-- ==========================================
-- Payment Terms - drives due_date and Days-Sales-Outstanding for Wholesale
-- credit customers.
-- ==========================================
CREATE TABLE IF NOT EXISTS payment_terms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    days INTEGER NOT NULL DEFAULT 0,
    description TEXT
);

INSERT INTO payment_terms (name, days, description) VALUES
    ('Due on Receipt', 0, 'Payment due immediately - the default for cash/retail sales'),
    ('Net 15', 15, 'Payment due within 15 days'),
    ('Net 30', 30, 'Payment due within 30 days'),
    ('Net 60', 60, 'Payment due within 60 days')
ON CONFLICT DO NOTHING;

-- ==========================================
-- Channel dimension - the single column that makes every existing sales
-- report (Sales Summary, Outstanding, P&L, Balance Sheet) channel-aware
-- without changing their queries beyond an added GROUP BY/filter column.
-- ==========================================
ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'wholesale';
ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER REFERENCES payment_terms(id);
ALTER TABLE sale_order_items ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'wholesale';
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS price_list_id INTEGER REFERENCES price_lists(id);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE sales_items ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list_id INTEGER REFERENCES price_lists(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_id INTEGER REFERENCES payment_terms(id);

-- ==========================================
-- Channel-split revenue: rename the existing Sales Revenue account to make
-- room for a dedicated Retail Revenue account, so channel gross margin is
-- a General Ledger figure, not a report-layer estimate. Existing history
-- posted under 4000 is unaffected - only the label changes.
-- ==========================================
UPDATE chart_of_accounts SET name = 'Wholesale Revenue' WHERE code = '4000';

INSERT INTO chart_of_accounts (code, name, account_type, normal_balance) VALUES
    ('4010', 'Retail Revenue', 'income', 'credit')
ON CONFLICT (code) DO NOTHING;

-- ==========================================
-- A fixed "Cash Customer" record - the default walk-in customer for POS,
-- so checkout never blocks on customer selection. Well-known by name lookup
-- (application code resolves it once and can cache the id).
-- ==========================================
INSERT INTO customers (name, customer_type, credit_limit, outstanding_balance)
SELECT 'Cash Customer', 'Individual', 0, 0
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = 'Cash Customer');
