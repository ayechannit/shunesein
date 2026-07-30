-- Retail (POS) foundation: registers, cash-drawer shifts, and a thin link
-- table from a shift to the sales_invoices it rang up. POS deliberately has
-- no transaction table of its own for the sale itself - a checkout creates a
-- normal sales_invoices/sales_items row (channel = 'retail') through the same
-- pipeline Wholesale uses, so the existing reporting layer stays channel-aware
-- for free. pos_sales exists only so shift-based reports (Cashier Performance,
-- Shift Closing, Daily POS Summary) don't need to reverse-engineer "which
-- invoices happened during this shift" from timestamps.

CREATE TABLE IF NOT EXISTS pos_registers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    warehouse_id INTEGER REFERENCES warehouses(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_shifts (
    id SERIAL PRIMARY KEY,
    register_id INTEGER REFERENCES pos_registers(id),
    cashier_id INTEGER REFERENCES users(id),
    opening_cash DECIMAL(15,2) NOT NULL DEFAULT 0,
    closing_cash DECIMAL(15,2),
    expected_cash DECIMAL(15,2),
    cash_difference DECIMAL(15,2),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    note TEXT,
    opened_at TIMESTAMP DEFAULT NOW(),
    closed_at TIMESTAMP
);

-- A register can only have one open shift at a time - enforced here rather
-- than only in application code, since two cashiers racing to open the same
-- physical drawer is exactly the kind of thing a unique index catches and an
-- app-level SELECT-then-INSERT check can miss.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_shifts_one_open_per_register
    ON pos_shifts(register_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS pos_sales (
    id SERIAL PRIMARY KEY,
    shift_id INTEGER REFERENCES pos_shifts(id),
    invoice_id INTEGER REFERENCES sales_invoices(id),
    register_id INTEGER REFERENCES pos_registers(id),
    cashier_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_sales_shift ON pos_sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_pos_sales_invoice ON pos_sales(invoice_id);

-- Shift close needs to know how much of a shift's takings should physically
-- be sitting in the cash drawer, and payment_methods is free-form master data
-- with no fixed rows to key off of - so which tender types count as cash has
-- to be a flag on the row, not an assumption about a specific code/name.
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS affects_cash_drawer BOOLEAN DEFAULT false;

INSERT INTO payment_methods (code, name, affects_cash_drawer)
SELECT 'CASH', 'Cash', true
WHERE NOT EXISTS (SELECT 1 FROM payment_methods WHERE code = 'CASH');

-- If a CASH-coded payment method already existed (created through the UI
-- before this migration ever ran), the guarded INSERT above skips it and
-- leaves affects_cash_drawer at its false default - which would silently
-- zero out every shift's cash reconciliation. Backfill it explicitly.
UPDATE payment_methods SET affects_cash_drawer = true WHERE code = 'CASH';

INSERT INTO permissions (name, module, description) VALUES
('pos_operate', 'POS', 'Can open/close a POS shift and ring up sales at the register'),
('pos_override', 'POS', 'Can perform manager-override actions at the register (price override, void, close another cashier''s shift)'),
('pos_manage', 'POS', 'Can manage POS registers and view all shift/cash reports')
ON CONFLICT (name) DO NOTHING;

-- Owner/Manager get full POS access; Cashier gets day-to-day register
-- operation only (no register management, no override).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('Owner', 'Manager') AND p.name IN ('pos_operate', 'pos_override', 'pos_manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Cashier' AND p.name = 'pos_operate'
ON CONFLICT DO NOTHING;
