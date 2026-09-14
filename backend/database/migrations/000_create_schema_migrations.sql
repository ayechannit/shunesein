-- Tracks which migration files have been applied to a given database, so
-- there's a reliable answer to "what's actually live on this environment"
-- instead of relying on memory of what someone ran by hand. Named 000 so it
-- always sorts first and creates itself before scripts/migrate.js needs it -
-- that script also creates this table defensively on its own, so this file
-- existing in the migrations/ folder is documentation as much as anything.
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
