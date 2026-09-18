-- Adds a Price Level pricing model alongside the existing quantity-tier
-- pricing (product_price_tiers) - additive, not a replacement. A Price Level
-- (e.g. "Retail", "Wholesale", "VIP") carries one flat price per product;
-- which levels a role can see/use in Sales is controlled per-role via
-- role_price_levels, mirroring how role_permissions already scopes
-- permissions per role. Safe to re-run: every insert is guarded.

CREATE TABLE IF NOT EXISTS price_levels (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_price_by_level (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price_level_id INTEGER NOT NULL REFERENCES price_levels(id) ON DELETE CASCADE,
    price DECIMAL(15, 2) NOT NULL DEFAULT 0,
    UNIQUE (product_id, price_level_id)
);

-- Which price levels a role is allowed to use - unlike the fixed permission
-- catalog, price levels are user-created, so this is a plain many-to-many
-- table (assigned via the Roles screen) rather than a `permissions` row per level.
CREATE TABLE IF NOT EXISTS role_price_levels (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    price_level_id INTEGER NOT NULL REFERENCES price_levels(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, price_level_id)
);

INSERT INTO permissions (name, module, description) VALUES
    ('manage_price_levels', 'Master Data', 'Can create, edit and delete price levels and set per-product prices for each level')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Owner' AND p.name = 'manage_price_levels'
ON CONFLICT DO NOTHING;

-- Seed one default level so the Sales price-level dropdown isn't empty on
-- day one, and give every existing role access to it so nobody's Sales
-- screen loses its price-level picker as a direct result of this migration.
INSERT INTO price_levels (name, description) VALUES
    ('Standard', 'Default price level')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_price_levels (role_id, price_level_id)
SELECT r.id, pl.id FROM roles r CROSS JOIN price_levels pl
WHERE pl.name = 'Standard'
ON CONFLICT DO NOTHING;
