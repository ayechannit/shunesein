// Permission name constants shared across route definitions.
// Must stay in sync with the `permissions` table (see database/migrations).
module.exports = {
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  // Master Data used to be gated by one manage_master_data permission for
  // all 7 entities below - split per-entity in migration 019 so a role can
  // be given access to e.g. Products without also getting Suppliers/Accounts/etc.
  MANAGE_CATEGORIES: 'manage_categories',
  MANAGE_PRODUCTS: 'manage_products',
  MANAGE_SUPPLIERS: 'manage_suppliers',
  MANAGE_CUSTOMERS: 'manage_customers',
  MANAGE_WAREHOUSES: 'manage_warehouses',
  MANAGE_ACCOUNTS: 'manage_accounts',
  MANAGE_PAYMENT_METHODS: 'manage_payment_methods',
  // Procurement used to be gated by one manage_procurement permission for
  // Orders/Vouchers/Returns - split per-item in migration 019.
  MANAGE_PURCHASE_ORDERS: 'manage_purchase_orders',
  MANAGE_PURCHASE_VOUCHERS: 'manage_purchase_vouchers',
  MANAGE_PURCHASE_RETURNS: 'manage_purchase_returns',
  // Sales used to be gated by one process_sales permission for
  // Orders/Invoices/Returns - split per-item in migration 019.
  MANAGE_SALE_ORDERS: 'manage_sale_orders',
  MANAGE_SALES_INVOICES: 'manage_sales_invoices',
  MANAGE_SALES_RETURNS: 'manage_sales_returns',
  MANAGE_STOCK: 'manage_stock',
  MANAGE_PRODUCTION: 'manage_production',
  MANAGE_PAYMENTS: 'manage_payments',
  // Finance used to be gated by one manage_finance permission for
  // Categories/Entries/Transfers - split per-item in migration 019.
  MANAGE_FINANCE_CATEGORIES: 'manage_finance_categories',
  MANAGE_FINANCE_ENTRIES: 'manage_finance_entries',
  MANAGE_FINANCE_TRANSFERS: 'manage_finance_transfers',
  MANAGE_DELIVERY: 'manage_delivery',
  MANAGE_SETTINGS: 'manage_settings',
  // Reports used to be gated by two umbrella permissions (view_reports for
  // operational reports, view_financial_reports for financially-sensitive
  // ones) - split into one permission per report page in migration 020, so
  // a role can be given e.g. just Current Stock without every other report.
  VIEW_REPORT_CURRENT_STOCK: 'view_report_current_stock',
  VIEW_REPORT_LOW_STOCK: 'view_report_low_stock',
  VIEW_REPORT_STOCK_MOVEMENT: 'view_report_stock_movement',
  VIEW_REPORT_STOCK_LEDGER: 'view_report_stock_ledger',
  VIEW_REPORT_PURCHASE_SUMMARY: 'view_report_purchase_summary',
  VIEW_REPORT_PRODUCTION_SUMMARY: 'view_report_production_summary',
  VIEW_REPORT_SALES_BACKLOG: 'view_report_sales_backlog',
  VIEW_REPORT_OPEN_PURCHASE_ORDERS: 'view_report_open_purchase_orders',
  VIEW_REPORT_INVENTORY_VALUATION: 'view_report_inventory_valuation',
  VIEW_REPORT_SLOW_MOVING_STOCK: 'view_report_slow_moving_stock',
  VIEW_REPORT_ABC_ANALYSIS: 'view_report_abc_analysis',
  VIEW_REPORT_STOCK_TRANSFER_REGISTER: 'view_report_stock_transfer_register',
  VIEW_REPORT_STOCK_ADJUSTMENTS: 'view_report_stock_adjustments',
  VIEW_REPORT_PO_VARIANCE: 'view_report_po_variance',
  VIEW_REPORT_SUPPLIER_PRICE_TREND: 'view_report_supplier_price_trend',
  VIEW_REPORT_DELIVERY_PERFORMANCE: 'view_report_delivery_performance',
  VIEW_REPORT_DOCUMENT_REGISTER: 'view_report_document_register',
  VIEW_REPORT_SUPPLIER_SCORECARD: 'view_report_supplier_scorecard',
  VIEW_REPORT_EXPIRY: 'view_report_expiry',
  VIEW_REPORT_SALES_RETURNS: 'view_report_sales_returns',
  VIEW_REPORT_PURCHASE_RETURNS: 'view_report_purchase_returns',
  VIEW_REPORT_SALES_SUMMARY: 'view_report_sales_summary',
  VIEW_REPORT_OUTSTANDING: 'view_report_outstanding',
  VIEW_REPORT_PROFIT_LOSS: 'view_report_profit_loss',
  VIEW_REPORT_TAX_SUMMARY: 'view_report_tax_summary',
  VIEW_REPORT_EXPENSE: 'view_report_expense',
  VIEW_REPORT_CUSTOMER_STATEMENT: 'view_report_customer_statement',
  VIEW_REPORT_SUPPLIER_STATEMENT: 'view_report_supplier_statement',
  VIEW_REPORT_CASH_FLOW: 'view_report_cash_flow',
  VIEW_REPORT_FUND_TRANSFER_REGISTER: 'view_report_fund_transfer_register',
  VIEW_REPORT_SALESPERSON_PERFORMANCE: 'view_report_salesperson_performance',
  VIEW_REPORT_CHART_OF_ACCOUNTS: 'view_report_chart_of_accounts',
  VIEW_REPORT_TRIAL_BALANCE: 'view_report_trial_balance',
  VIEW_REPORT_BALANCE_SHEET: 'view_report_balance_sheet',
  VIEW_REPORT_JOURNAL_REGISTER: 'view_report_journal_register',
  VIEW_REPORT_SALES_BY_CATEGORY: 'view_report_sales_by_category',
  VIEW_REPORT_PAYMENT_METHOD_ANALYSIS: 'view_report_payment_method_analysis',
  VIEW_AUDIT_LOG: 'view_audit_log',
  MANAGE_PRICE_LISTS: 'manage_price_lists',
};
