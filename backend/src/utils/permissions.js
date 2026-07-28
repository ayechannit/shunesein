// Permission name constants shared across route definitions.
// Must stay in sync with the `permissions` table (see database/migrations).
module.exports = {
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  MANAGE_MASTER_DATA: 'manage_master_data',
  MANAGE_PROCUREMENT: 'manage_procurement',
  PROCESS_SALES: 'process_sales',
  MANAGE_STOCK: 'manage_stock',
  MANAGE_PRODUCTION: 'manage_production',
  MANAGE_PAYMENTS: 'manage_payments',
  MANAGE_FINANCE: 'manage_finance',
  MANAGE_DELIVERY: 'manage_delivery',
  MANAGE_SETTINGS: 'manage_settings',
  VIEW_REPORTS: 'view_reports',
  VIEW_AUDIT_LOG: 'view_audit_log',
};
