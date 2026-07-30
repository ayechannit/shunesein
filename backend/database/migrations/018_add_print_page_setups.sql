-- Replaces the single global print margin/page-size settings (6 flat
-- system_settings keys) with named, reusable page setups - create as many
-- as you need (A4, thermal receipt, Letter...), mark exactly one as the
-- default, and pick a different one at print time when needed.

CREATE TABLE IF NOT EXISTS print_page_setups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    margin_top DECIMAL(6,2) NOT NULL DEFAULT 15,
    margin_bottom DECIMAL(6,2) NOT NULL DEFAULT 15,
    margin_left DECIMAL(6,2) NOT NULL DEFAULT 10,
    margin_right DECIMAL(6,2) NOT NULL DEFAULT 10,
    page_width DECIMAL(6,2) NOT NULL DEFAULT 210,
    page_height DECIMAL(6,2) NOT NULL DEFAULT 297,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enforces "at most one default" at the database level, not just in
-- application code - the same pattern used for "one open shift per
-- register" earlier in this project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_print_page_setups_one_default
    ON print_page_setups (is_default) WHERE is_default = true;

-- Carry over whatever the single global setup already was (or the A4
-- fallback, if it was never touched) as the first named setup, marked default.
INSERT INTO print_page_setups (name, margin_top, margin_bottom, margin_left, margin_right, page_width, page_height, is_default)
SELECT
    'Default (A4)',
    COALESCE((SELECT value::decimal FROM system_settings WHERE key = 'print_margin_top'), 15),
    COALESCE((SELECT value::decimal FROM system_settings WHERE key = 'print_margin_bottom'), 15),
    COALESCE((SELECT value::decimal FROM system_settings WHERE key = 'print_margin_left'), 10),
    COALESCE((SELECT value::decimal FROM system_settings WHERE key = 'print_margin_right'), 10),
    COALESCE((SELECT value::decimal FROM system_settings WHERE key = 'print_page_width'), 210),
    COALESCE((SELECT value::decimal FROM system_settings WHERE key = 'print_page_height'), 297),
    true
WHERE NOT EXISTS (SELECT 1 FROM print_page_setups);

DELETE FROM system_settings WHERE key LIKE 'print_%';
