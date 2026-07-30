-- Wholesale quotations (the negotiation stage before a sale order) and a
-- generic credit-approval log (the gate before a wholesale order can be
-- approved once it would push a customer past their credit limit).
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS quotations (
    id SERIAL PRIMARY KEY,
    quotation_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    salesperson_id INTEGER REFERENCES users(id),
    quotation_date DATE DEFAULT CURRENT_DATE,
    valid_until DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, sent, accepted, rejected, expired, converted
    total_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    net_amount DECIMAL(15, 2) GENERATED ALWAYS AS (total_amount - discount_amount + tax_amount) STORED,
    converted_so_id INTEGER REFERENCES sale_orders(id),
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotation_items (
    id SERIAL PRIMARY KEY,
    quotation_id INTEGER REFERENCES quotations(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) NOT NULL,
    unit_price DECIMAL(15, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    subtotal DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price * (1 - discount_percent / 100.0)) STORED
);

-- Generic approval log - reference_type/reference_id today is always
-- ('sale_order', <id>), but the shape deliberately doesn't assume that, so
-- any future "needs sign-off" workflow can reuse this table rather than
-- growing a new one-off approvals table per feature.
CREATE TABLE IF NOT EXISTS credit_approvals (
    id SERIAL PRIMARY KEY,
    reference_type VARCHAR(30) NOT NULL,
    reference_id INTEGER NOT NULL,
    requested_by INTEGER REFERENCES users(id),
    requested_amount DECIMAL(15, 2) NOT NULL,
    credit_limit_at_request DECIMAL(15, 2) NOT NULL,
    outstanding_at_request DECIMAL(15, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_approvals_reference ON credit_approvals(reference_type, reference_id);

-- Traceability from an order back to the quotation it was converted from.
ALTER TABLE sale_orders ADD COLUMN IF NOT EXISTS quotation_id INTEGER REFERENCES quotations(id);

-- New permissions for the Wholesale module's approval gate and price-list
-- ownership. Owner/Manager get them automatically like every other module
-- permission added since the original RBAC expansion.
INSERT INTO permissions (name, module, description) VALUES
    ('approve_credit', 'Wholesale', 'Can approve or reject sale orders held for exceeding a customer''s credit limit'),
    ('manage_price_lists', 'Pricing', 'Can create and edit price lists, price list items, payment terms, and tax rates')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Owner' AND p.name IN ('approve_credit', 'manage_price_lists')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Manager' AND p.name IN ('approve_credit', 'manage_price_lists')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Accountant' AND p.name = 'approve_credit'
ON CONFLICT DO NOTHING;
