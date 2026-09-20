// Maps each MASTER_DATA_MODULE_ORDER key (see masterDataModules.js) to the
// backend permission name(s) that gate it - see backend/src/utils/permissions.js
// and the route files under backend/src/routes/ for the source of truth this
// was built from.
//
// `view`: required just to see/use this module at all. Only report modules
// carry one - reportRoutes.js gates every GET with checkPermission(view_report_*),
// so a user without it gets a 403 on the data itself, not just on editing.
// Everything else (master data reads, procurement/sales/inventory/finance
// list views) is deliberately open to any authenticated user on the backend
// (see masterRouterFactory.js's own comment: "Reads... stay open to any
// authenticated user"), so `view` is left unset there to match that
// philosophy rather than being stricter on the frontend than the API
// actually is.
//
// `write`: required to create/edit/delete/import within this module. Used
// to hide those buttons/actions, not the module itself, for master-data-
// style modules where reading remains allowed. `dashboard` and `finance-ledger`
// have neither - the dashboard has no permission check at all, and the
// ledger is a pure read view with no create/edit/delete of its own.
//
// `adminOnly: true` marks the Users/Roles/Permissions/Print-Setups group:
// technically their list reads aren't permission-gated on the backend
// either, but showing a full user/role directory or a settings screen to
// someone who can't act on any of it is a UX problem even where it isn't a
// security one - this hides the whole nav group unless the viewer holds at
// least one of its own `write`-equivalent permissions.
export const MODULE_PERMISSIONS = {
  dashboard: {},

  categories: { write: 'manage_categories' },
  products: { write: 'manage_products' },
  'price-levels': { write: 'manage_price_levels' },
  'price-level-pricing': { write: 'manage_price_levels' },
  suppliers: { write: 'manage_suppliers' },
  customers: { write: 'manage_customers' },
  warehouses: { write: 'manage_warehouses' },
  accounts: { write: 'manage_accounts' },
  'payment-methods': { write: 'manage_payment_methods' },

  'purchase-orders': { write: 'manage_purchase_orders', edit: 'manage_purchase_orders_edit', delete: 'manage_purchase_orders_delete' },
  'purchase-vouchers': { write: 'manage_purchase_vouchers', edit: 'manage_purchase_vouchers_edit', delete: 'manage_purchase_vouchers_delete' },
  'goods-receipts': { write: 'manage_goods_receipts', delete: 'manage_goods_receipts_delete' },
  'goods-returns': { write: 'manage_goods_returns', delete: 'manage_goods_returns_delete' },
  'supplier-deposits': { write: 'manage_supplier_deposits', delete: 'manage_supplier_deposits_delete' },

  'sale-orders': { write: 'manage_sale_orders', edit: 'manage_sale_orders_edit', delete: 'manage_sale_orders_delete' },
  'sales-invoices': { write: 'manage_sales_invoices', edit: 'manage_sales_invoices_edit', delete: 'manage_sales_invoices_delete' },
  'sales-returns': { write: 'manage_sales_returns', edit: 'manage_sales_returns_edit', delete: 'manage_sales_returns_delete' },

  delivery: { write: 'manage_delivery', edit: 'manage_delivery_edit', delete: 'manage_delivery_delete' },
  'production-batches': { write: 'manage_production', edit: 'manage_production_edit', delete: 'manage_production_delete' },
  'stock-transfers': { write: 'manage_stock', edit: 'manage_stock_edit', delete: 'manage_stock_delete' },
  'stock-adjustments': { write: 'manage_stock', edit: 'manage_stock_edit', delete: 'manage_stock_delete' },
  'stock-count': { write: 'manage_stock' },

  payments: { write: 'manage_payments', edit: 'manage_payments_edit', delete: 'manage_payments_delete' },
  'income-expense-categories': { write: 'manage_finance_categories' },
  'finance-entries': { write: 'manage_finance_entries', edit: 'manage_finance_entries_edit', delete: 'manage_finance_entries_delete' },
  'finance-transfers': { write: 'manage_finance_transfers', edit: 'manage_finance_transfers_edit', delete: 'manage_finance_transfers_delete' },
  'finance-ledger': {},

  'report-current-stock': { view: 'view_report_current_stock' },
  'report-low-stock': { view: 'view_report_low_stock' },
  'report-stock-movement': { view: 'view_report_stock_movement' },
  'report-stock-ledger': { view: 'view_report_stock_ledger' },
  'report-purchase-summary': { view: 'view_report_purchase_summary' },
  'report-production-summary': { view: 'view_report_production_summary' },
  'report-sales-summary': { view: 'view_report_sales_summary' },
  'report-sales-by-category': { view: 'view_report_sales_by_category' },
  'report-payment-method-analysis': { view: 'view_report_payment_method_analysis' },
  'report-outstanding': { view: 'view_report_outstanding' },
  'report-profit-loss': { view: 'view_report_profit_loss' },
  'report-tax-summary': { view: 'view_report_tax_summary' },
  'report-expense': { view: 'view_report_expense' },
  'report-customer-statement': { view: 'view_report_customer_statement' },
  'report-supplier-statement': { view: 'view_report_supplier_statement' },
  'report-sales-backlog': { view: 'view_report_sales_backlog' },
  'report-open-purchase-orders': { view: 'view_report_open_purchase_orders' },
  'report-inventory-valuation': { view: 'view_report_inventory_valuation' },
  'report-slow-moving-stock': { view: 'view_report_slow_moving_stock' },
  'report-abc-analysis': { view: 'view_report_abc_analysis' },
  'report-stock-transfer-register': { view: 'view_report_stock_transfer_register' },
  'report-stock-adjustment': { view: 'view_report_stock_adjustments' },
  'report-po-variance': { view: 'view_report_po_variance' },
  'report-supplier-price-trend': { view: 'view_report_supplier_price_trend' },
  'report-cash-flow': { view: 'view_report_cash_flow' },
  'report-fund-transfer-register': { view: 'view_report_fund_transfer_register' },
  'report-supplier-deposit-register': { view: 'view_report_supplier_deposit_register' },
  'report-delivery-performance': { view: 'view_report_delivery_performance' },
  'report-document-register': { view: 'view_report_document_register' },
  'report-salesperson-performance': { view: 'view_report_salesperson_performance' },
  'report-supplier-scorecard': { view: 'view_report_supplier_scorecard' },
  'report-expiry': { view: 'view_report_expiry' },
  'report-sales-returns': { view: 'view_report_sales_returns' },
  'report-purchase-returns': { view: 'view_report_purchase_returns' },
  'report-chart-of-accounts': { view: 'view_report_chart_of_accounts' },
  'report-trial-balance': { view: 'view_report_trial_balance' },
  'report-balance-sheet': { view: 'view_report_balance_sheet' },
  'report-journal-register': { view: 'view_report_journal_register' },

  users: { write: 'manage_users', adminOnly: true },
  roles: { write: 'manage_roles', adminOnly: true },
  permissions: { write: 'manage_roles', adminOnly: true },
  'audit-log': { view: 'view_audit_log', adminOnly: true },
  'print-page-setups': { write: 'manage_settings', adminOnly: true },
};

// True if the current permission set allows this module to appear in
// navigation at all (view-gated reports, and the admin-only group).
export const canViewModule = (moduleKey, hasPermission) => {
  const entry = MODULE_PERMISSIONS[moduleKey];
  if (!entry) return true;
  if (entry.view && !hasPermission(entry.view)) return false;
  if (entry.adminOnly && entry.write && !hasPermission(entry.write)) return false;
  return true;
};

// True if the current permission set allows create/edit/delete/import
// within this module - used to hide those specific actions, not the module.
export const canWriteModule = (moduleKey, hasPermission) => {
  const entry = MODULE_PERMISSIONS[moduleKey];
  if (!entry || !entry.write) return true;
  return hasPermission(entry.write);
};

// True if this module has its edit/delete permissions split out from create
// (transaction modules only, see migration 023). Falls back to canWriteModule
// for every other module, which still uses one write permission for
// create/edit/delete together.
export const canEditModule = (moduleKey, hasPermission) => {
  const entry = MODULE_PERMISSIONS[moduleKey];
  if (!entry || !entry.edit) return canWriteModule(moduleKey, hasPermission);
  return hasPermission(entry.edit);
};

export const canDeleteModule = (moduleKey, hasPermission) => {
  const entry = MODULE_PERMISSIONS[moduleKey];
  if (!entry || !entry.delete) return canWriteModule(moduleKey, hasPermission);
  return hasPermission(entry.delete);
};
