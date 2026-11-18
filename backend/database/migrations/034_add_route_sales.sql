-- Route (van / motorcycle) sales with an end-of-day settlement.
--
-- A VEHICLE is a stock location + a cash bag: creating one (RouteController)
-- also creates its own warehouse (stock carried on board) and its own cash
-- account (money collected on the road, not yet handed in).
--
-- A ROUTE TRIP is one day out for one vehicle + salesperson:
--   1. Load Out   - stock moves main warehouse -> vehicle warehouse
--                   (route_trip_load_items). Pre-made invoices can also be
--                   attached for delivery/collection (sales_invoices.route_trip_id).
--   2. On route   - the rider's tablet invoices are tagged with the trip and
--                   sell from the vehicle warehouse; cash receipts go into the
--                   vehicle cash account.
--   3. Settlement - counted stock vs system stock (variance booked like a stock
--                   adjustment), leftover stock returned or kept on board, and
--                   counted cash vs expected cash. Counted cash moves to the
--                   chosen office account; a shortage becomes money the
--                   salesperson owes (staff_balance_entries, GL 1150); an
--                   overage is booked as other income.
--
-- Safe to re-run.

-- ==========================================
-- 1. Vehicles
-- ==========================================
CREATE TABLE IF NOT EXISTS vehicles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    vehicle_type VARCHAR(20) NOT NULL DEFAULT 'van', -- van, motorcycle, other
    plate_number VARCHAR(50),
    warehouse_id INTEGER UNIQUE NOT NULL REFERENCES warehouses(id),
    cash_account_id INTEGER UNIQUE NOT NULL REFERENCES accounts(id),
    default_salesperson_id INTEGER REFERENCES users(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 2. Route trips
-- ==========================================
CREATE TABLE IF NOT EXISTS route_trips (
    id SERIAL PRIMARY KEY,
    trip_number VARCHAR(50) UNIQUE NOT NULL,
    trip_date DATE NOT NULL,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    salesperson_id INTEGER REFERENCES users(id),
    route_name VARCHAR(150),
    source_warehouse_id INTEGER REFERENCES warehouses(id),
    status VARCHAR(20) NOT NULL DEFAULT 'on_route', -- on_route, settled
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- settlement
    settled_at TIMESTAMPTZ,
    settled_by INTEGER REFERENCES users(id),
    deposit_account_id INTEGER REFERENCES accounts(id),
    return_warehouse_id INTEGER REFERENCES warehouses(id),
    cash_expected NUMERIC(15, 2),
    cash_counted NUMERIC(15, 2),
    cash_difference NUMERIC(15, 2), -- counted - expected (negative = short)
    stock_variance_value NUMERIC(15, 2), -- at cost, negative = missing stock
    settlement_remark TEXT
);
CREATE INDEX IF NOT EXISTS idx_route_trips_vehicle ON route_trips(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_route_trips_status ON route_trips(status);
-- One open trip per vehicle at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_trips_one_open_per_vehicle ON route_trips(vehicle_id) WHERE status = 'on_route';

CREATE TABLE IF NOT EXISTS route_trip_load_items (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES route_trips(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity NUMERIC(15, 2) NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_route_trip_load_items_trip ON route_trip_load_items(trip_id);

CREATE TABLE IF NOT EXISTS route_trip_stock_counts (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES route_trips(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    system_qty NUMERIC(15, 2) NOT NULL,
    counted_qty NUMERIC(15, 2) NOT NULL,
    variance_qty NUMERIC(15, 2) NOT NULL, -- counted - system
    returned_qty NUMERIC(15, 2) NOT NULL DEFAULT 0,
    kept_qty NUMERIC(15, 2) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(15, 2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_route_trip_stock_counts_trip ON route_trip_stock_counts(trip_id);

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS route_trip_id INTEGER REFERENCES route_trips(id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_route_trip ON sales_invoices(route_trip_id);

-- ==========================================
-- 3. Money a salesperson owes (cash shortages) and repays
-- ==========================================
-- amount > 0: owes more (shortage); amount < 0: repaid. Balance = SUM(amount).
CREATE TABLE IF NOT EXISTS staff_balance_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    trip_id INTEGER REFERENCES route_trips(id),
    entry_date DATE NOT NULL,
    amount NUMERIC(15, 2) NOT NULL,
    account_id INTEGER REFERENCES accounts(id), -- where a repayment was paid into
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_balance_entries_user ON staff_balance_entries(user_id);

INSERT INTO chart_of_accounts (code, name, account_type, normal_balance) VALUES
    ('1150', 'Staff Receivable (Cash Shortages)', 'asset', 'debit')
ON CONFLICT (code) DO NOTHING;

-- ==========================================
-- 4. Permissions
-- ==========================================
INSERT INTO permissions (name, module, description) VALUES
    ('manage_vehicles', 'Sales', 'Can add and edit route vehicles (vans / motorcycles)'),
    ('manage_route_trips', 'Sales', 'Can start route trips, load stock onto vehicles and attach invoices'),
    ('settle_route_trips', 'Sales', 'Can settle route trips (count stock and cash) and record salesperson repayments')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN ('manage_vehicles', 'manage_route_trips', 'settle_route_trips')
WHERE r.name IN ('Owner', 'Manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name = 'manage_route_trips'
WHERE r.name = 'Sales Staff'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name = 'settle_route_trips'
WHERE r.name = 'Accountant'
ON CONFLICT DO NOTHING;

-- ==========================================
-- 5. Turn the existing "Van-1" warehouse into the first vehicle
-- ==========================================
INSERT INTO accounts (name, account_type, balance)
SELECT 'Van-1 Cash', 'ငွေသား', 0
WHERE EXISTS (SELECT 1 FROM warehouses WHERE name = 'Van-1')
  AND NOT EXISTS (SELECT 1 FROM vehicles WHERE name = 'Van-1')
  AND NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'Van-1 Cash');

INSERT INTO vehicles (name, vehicle_type, warehouse_id, cash_account_id)
SELECT 'Van-1', 'van', w.id, a.id
FROM warehouses w
JOIN accounts a ON a.name = 'Van-1 Cash'
WHERE w.name = 'Van-1'
ON CONFLICT DO NOTHING;
