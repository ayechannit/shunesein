-- Adds fund_transfers: covers deposits, withdrawals, and transfers as one
-- primitive - moving money between two of the business's own accounts.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS fund_transfers (
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
