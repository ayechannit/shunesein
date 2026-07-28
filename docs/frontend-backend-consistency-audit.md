# Frontend ↔ Backend Consistency Audit

## Audit summary

The current master-data frontend modules were checked against the PostgreSQL schema in the backend and found to be aligned for the active modules:

- Categories
- Products
- Suppliers
- Customers
- Warehouses
- Accounts
- Payment Methods
- Roles
- Permissions

## Module field status

- Categories: ✅ aligned (name, description, created_at)
- Products: ✅ aligned (product_code, barcode, name, category_id, group_name, unit, contains, cost_price, markup_type, markup_value, selling_price, min_stock_level, product_type, status)
- Suppliers: ✅ aligned (name, contact_person, phone, email, address, outstanding_balance, created_at)
- Customers: ✅ aligned (name, customer_type, contact_person, phone, email, address, credit_limit, outstanding_balance, created_at)
- Warehouses: ✅ aligned (name, location, warehouse_type, created_at)
- Accounts: ✅ aligned (name, account_type, account_number, bank_name, balance, created_at)
- Payment Methods: ✅ aligned (code, name, description, is_active)
- Roles: ✅ aligned (name, description, created_at)
- Permissions: ✅ aligned (name, module, description)

## Hardened safeguards

To prevent future mismatches from causing failures, the backend now validates incoming create/update payloads against an allowlist of known columns for each module, and the frontend now renders table values defensively when a backend response omits a field.
