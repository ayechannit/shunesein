-- PostgreSQL Schema for Tea Leaf & Fried Bean Management System (Shunesein)

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. User & Permission Management
-- ==========================================

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(100),
    role_id INTEGER REFERENCES roles(id),
    status VARCHAR(20) DEFAULT 'active', -- active, inactive, suspended
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    module VARCHAR(50),
    description TEXT
);

CREATE TABLE role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ==========================================
-- 2. Master Data
-- ==========================================

CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(50) UNIQUE, -- Customer: Stock ID
    barcode VARCHAR(50) UNIQUE,
    name VARCHAR(255) NOT NULL, -- Customer: Stock Name
    category_id INTEGER REFERENCES categories(id), -- Customer: Category
    group_name VARCHAR(100), -- Customer: Group
    unit VARCHAR(20), -- Customer: Unit
    contains TEXT, -- Customer: Contains (e.g., ingredients or packaging details)
    cost_price DECIMAL(15, 2) DEFAULT 0.00, -- Customer: Cost
    markup_type VARCHAR(20) DEFAULT 'fixed', -- fixed, percentage
    markup_value DECIMAL(15, 2) DEFAULT 0.00, -- fixed amount or percentage value
    selling_price DECIMAL(15, 2) DEFAULT 0.00, -- Customer: Price (Final calculated or manual price)
    min_stock_level DECIMAL(15, 2) DEFAULT 0.00,
    product_type_id INTEGER NOT NULL REFERENCES product_types(id),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Migration-safe backfill for existing databases
INSERT INTO product_types (name, description)
VALUES ('Uncategorized', 'Default product type')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS product_type_id INTEGER;

UPDATE products
SET product_type_id = (
    SELECT id FROM product_types WHERE name = 'Uncategorized' LIMIT 1
)
WHERE product_type_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.products'::regclass
          AND conname = 'products_product_type_id_fkey'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_product_type_id_fkey
            FOREIGN KEY (product_type_id) REFERENCES product_types(id);
    END IF;
END $$;

ALTER TABLE products
    ALTER COLUMN product_type_id SET NOT NULL;

CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    outstanding_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    customer_type VARCHAR(50), -- Distributor, Wholesaler, Retail, Individual
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    credit_limit DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    outstanding_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE warehouses (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    location VARCHAR(255),
    warehouse_type VARCHAR(50), -- Raw Material, Finished Goods, Retail Shop, Branch
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Current Stock Levels (Real-time tracking per warehouse)
CREATE TABLE stock_levels (
    warehouse_id INTEGER REFERENCES warehouses(id),
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) DEFAULT 0.00,
    PRIMARY KEY (warehouse_id, product_id)
);

-- ==========================================
-- 3. Procurement (Purchase Order & Voucher)
-- ==========================================

CREATE TABLE purchase_orders (
    id SERIAL PRIMARY KEY,
    po_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    order_date DATE DEFAULT CURRENT_DATE,
    total_amount DECIMAL(15,2) DEFAULT 0.00,
    discount_amount DECIMAL(15,2) DEFAULT 0.00,
    net_amount DECIMAL(15,2)
        GENERATED ALWAYS AS (total_amount - discount_amount) STORED,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, received, cancelled
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_order_items (
    id SERIAL PRIMARY KEY,
    po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    subtotal DECIMAL(15,2)
        GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE purchase_vouchers (
    id SERIAL PRIMARY KEY,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,
    po_id INTEGER REFERENCES purchase_orders(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    warehouse_id INTEGER REFERENCES warehouses(id),

    voucher_date DATE DEFAULT CURRENT_DATE,

    total_amount DECIMAL(15,2) NOT NULL,
    discount_amount DECIMAL(15,2) DEFAULT 0.00,
    tax_amount DECIMAL(15,2) DEFAULT 0.00,

    net_amount DECIMAL(15,2)
        GENERATED ALWAYS AS
        (total_amount - discount_amount + tax_amount) STORED,

    payment_status VARCHAR(20) DEFAULT 'unpaid',
    -- unpaid / partial / paid

    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_items (
    id SERIAL PRIMARY KEY,
    voucher_id INTEGER REFERENCES purchase_vouchers(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    subtotal DECIMAL(15,2)
        GENERATED ALWAYS AS (quantity * unit_price) STORED
);

-- ==========================================
-- 4. Sales (Sale Order & Invoice)
-- ==========================================

CREATE TABLE sale_orders (
    id SERIAL PRIMARY KEY,
    so_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    order_date DATE DEFAULT CURRENT_DATE,
    total_amount DECIMAL(15,2) DEFAULT 0.00,
    discount_amount DECIMAL(15,2) DEFAULT 0.00,
    net_amount DECIMAL(15,2)
        GENERATED ALWAYS AS (total_amount - discount_amount) STORED,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, invoiced, delivered, cancelled
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_order_items (
    id SERIAL PRIMARY KEY,
    so_id INTEGER REFERENCES sale_orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    subtotal DECIMAL(15,2)
        GENERATED ALWAYS AS (quantity * unit_price) STORED
);

CREATE TABLE sales_invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    so_id INTEGER REFERENCES sale_orders(id),
    customer_id INTEGER REFERENCES customers(id),
    warehouse_id INTEGER REFERENCES warehouses(id),

    invoice_date DATE DEFAULT CURRENT_DATE,

    total_amount DECIMAL(15,2) NOT NULL,
    discount_amount DECIMAL(15,2) DEFAULT 0.00,
    tax_amount DECIMAL(15,2) DEFAULT 0.00,

    net_amount DECIMAL(15,2)
        GENERATED ALWAYS AS
        (total_amount - discount_amount + tax_amount) STORED,

    payment_status VARCHAR(20) DEFAULT 'unpaid',
    -- unpaid / partial / paid

    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sales_items (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER REFERENCES sales_invoices(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15,2) NOT NULL,
    unit_price DECIMAL(15,2) NOT NULL,
    subtotal DECIMAL(15,2)
        GENERATED ALWAYS AS (quantity * unit_price) STORED
);

-- ==========================================
-- Payment Methods
-- ==========================================

CREATE TABLE payment_methods (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- ==========================================
-- Payments (Common for Purchase & Sales)
-- ==========================================

CREATE TABLE payments (
    id SERIAL PRIMARY KEY,

    transaction_type VARCHAR(20) NOT NULL,
    -- purchase
    -- sale

    transaction_id INTEGER NOT NULL,
    -- purchase_vouchers.id OR sales_invoices.id

    payment_date DATE DEFAULT CURRENT_DATE,

    payment_method_id INTEGER
        REFERENCES payment_methods(id),

    amount DECIMAL(15,2) NOT NULL,

    reference_no VARCHAR(100),

    bank_name VARCHAR(100),

    note TEXT,

    created_by INTEGER REFERENCES users(id),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- Inventory Operations
-- ==========================================

CREATE TABLE stock_transactions (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    warehouse_id INTEGER REFERENCES warehouses(id),
    quantity_change DECIMAL(15, 2) NOT NULL, -- Positive for increase, Negative for decrease
    transaction_type VARCHAR(50) NOT NULL, -- purchase, sale, transfer_out, transfer_in, adjustment, production
    reference_id INTEGER NOT NULL, -- ID of the originating record
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE production_batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(50) UNIQUE NOT NULL,
    start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, cancelled
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE production_raw_materials (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES production_batches(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) NOT NULL,
    warehouse_id INTEGER REFERENCES warehouses(id), -- Source warehouse for raw materials
    unit_cost DECIMAL(15, 2) -- Captured at time of production for accurate costing
);

CREATE TABLE production_finished_goods (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES production_batches(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) NOT NULL,
    warehouse_id INTEGER REFERENCES warehouses(id), -- Destination warehouse for finished goods
    unit_cost DECIMAL(15, 2) -- Calculated cost per finished good unit
);

CREATE TABLE stock_transfers (
    id SERIAL PRIMARY KEY,
    transfer_number VARCHAR(50) UNIQUE NOT NULL,
    from_warehouse_id INTEGER REFERENCES warehouses(id),
    to_warehouse_id INTEGER REFERENCES warehouses(id),
    date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, received, completed
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock_transfer_items (
    id SERIAL PRIMARY KEY,
    transfer_id INTEGER REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) NOT NULL
);

CREATE TABLE stock_adjustments (
    id SERIAL PRIMARY KEY,
    adjustment_number VARCHAR(50) UNIQUE NOT NULL,
    warehouse_id INTEGER REFERENCES warehouses(id),
    date DATE DEFAULT CURRENT_DATE,
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock_adjustment_items (
    id SERIAL PRIMARY KEY,
    adjustment_id INTEGER REFERENCES stock_adjustments(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    quantity DECIMAL(15, 2) NOT NULL, -- Positive for increase, negative for decrease
    type VARCHAR(20) -- damaged, missing, expired, manual
);

-- ==========================================
-- 6. Financial Management
-- ==========================================

CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    account_type VARCHAR(20), -- cash, bank
    account_number VARCHAR(50),
    bank_name VARCHAR(100),
    balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE income_expense_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL, -- income, expense
    description TEXT
);

CREATE TABLE income_expense_entries (
    id SERIAL PRIMARY KEY,
    category_id INTEGER REFERENCES income_expense_categories(id),
    date DATE DEFAULT CURRENT_DATE,
    amount DECIMAL(15, 2) NOT NULL,
    account_id INTEGER REFERENCES accounts(id),
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Covers deposits, withdrawals, and transfers as one primitive: moving money
-- between two of the business's own accounts (e.g. cash -> bank is a
-- "deposit", bank -> cash is a "withdrawal", bank -> bank is a "transfer").
CREATE TABLE fund_transfers (
    id SERIAL PRIMARY KEY,
    transfer_number VARCHAR(50) UNIQUE NOT NULL,
    from_account_id INTEGER REFERENCES accounts(id),
    to_account_id INTEGER REFERENCES accounts(id),
    amount DECIMAL(15, 2) NOT NULL,
    date DATE DEFAULT CURRENT_DATE,
    remark TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 7. Delivery & Audit
-- ==========================================

CREATE TABLE deliveries (
    id SERIAL PRIMARY KEY,
    delivery_number VARCHAR(50) UNIQUE NOT NULL,
    date DATE DEFAULT CURRENT_DATE,
    vehicle_info VARCHAR(100),
    driver_name VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending', -- pending, shipped, delivered, failed
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- A delivery (one truck run) can cover multiple sales invoices.
CREATE TABLE delivery_invoices (
    id SERIAL PRIMARY KEY,
    delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id),
    UNIQUE (delivery_id, invoice_id)
);

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL, -- CREATE, UPDATE, DELETE, LOGIN
    target_table VARCHAR(50),
    target_id INTEGER,
    old_value JSONB,
    new_value JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE system_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
