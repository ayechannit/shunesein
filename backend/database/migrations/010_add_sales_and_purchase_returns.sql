-- Sales Returns (credit notes) and Purchase Returns (debit notes) - flagged
-- in the reporting audit as a real gap: neither had a table before, so a
-- customer/supplier return had to be faked as a manual stock adjustment or
-- discount, which corrupted the sales/purchase numbers it touched.
--
-- Both are recorded as a single completed event (like stock_adjustments),
-- not a multi-stage order->voucher workflow - a return is normally entered
-- after the goods are already back in hand, so there's nothing to "approve"
-- first. Safe to re-run.

CREATE TABLE IF NOT EXISTS sales_returns (
    id SERIAL PRIMARY KEY,
    return_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_id INTEGER REFERENCES sales_invoices(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    return_date DATE DEFAULT CURRENT_DATE,
    reason TEXT,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_return_items (
    id SERIAL PRIMARY KEY,
    return_id INTEGER REFERENCES sales_returns(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    subtotal DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE IF NOT EXISTS purchase_returns (
    id SERIAL PRIMARY KEY,
    return_number VARCHAR(50) UNIQUE NOT NULL,
    voucher_id INTEGER REFERENCES purchase_vouchers(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    return_date DATE DEFAULT CURRENT_DATE,
    reason TEXT,
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id SERIAL PRIMARY KEY,
    return_id INTEGER REFERENCES purchase_returns(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    subtotal DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);
