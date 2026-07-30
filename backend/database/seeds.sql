-- Initial Roles
INSERT INTO roles (name, description) VALUES 
('Owner', 'Full system access'),
('Manager', 'General management access'),
('Accountant', 'Financial and report access'),
('Warehouse Staff', 'Stock and inventory access'),
('Production Staff', 'Manufacturing and raw material access'),
('Sales Staff', 'Sales and customer management access'),
('Cashier', 'POS and payment receipt access');

-- Initial Permissions (Examples)
INSERT INTO permissions (name, module, description) VALUES 
('manage_users', 'User Management', 'Can create, edit and delete users'),
('view_reports', 'Reports', 'Can view all system reports'),
('manage_stock', 'Inventory', 'Can adjust stock and transfer inventory'),
('process_sales', 'Sales', 'Can create sales invoices'),
('manage_production', 'Production', 'Can manage production batches');

-- Initial Product Types
-- Fixed to exactly these two - there is no create/edit/delete UI or API for
-- product types, since every product must be either a raw material consumed
-- by production or a finished good produced by it.
INSERT INTO product_types (name, description) VALUES
('Raw Material', 'Raw Material'),
('Finished Goods', 'Finished Goods');

-- Assign all permissions to Owner (Role ID 1)
INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

-- Initial Admin User (Username: admin, Password: admin)
-- Hash generated for 'admin'
INSERT INTO users (username, password_hash, full_name, role_id, status) VALUES
('admin', '$2b$10$tXtyL3pqH6qsoYWb9rx95.lngcEAYo6XL/CdNOADUcM.eqrNdD/J2', 'System Administrator', 1, 'active');

-- Print page setup (Purchase Orders, Vouchers, Sale Orders, Invoices).
-- Fixed set of keys - the Settings screen only ever updates these, never
-- creates or deletes rows. Defaults to A4.
INSERT INTO system_settings (key, value, description) VALUES
    ('print_margin_top', '15', 'Print page top margin in millimeters'),
    ('print_margin_bottom', '15', 'Print page bottom margin in millimeters'),
    ('print_margin_left', '10', 'Print page left margin in millimeters'),
    ('print_margin_right', '10', 'Print page right margin in millimeters'),
    ('print_page_width', '210', 'Print page width in millimeters (A4 = 210)'),
    ('print_page_height', '297', 'Print page height in millimeters (A4 = 297)');
