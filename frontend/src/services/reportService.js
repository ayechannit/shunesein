const API_ROOT = 'http://localhost:5000/api';

const buildRequest = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null ? payload.message || payload.error : payload;
    const error = new Error(message || 'Request failed');
    error.status = response.status;
    throw error;
  }

  return payload;
};

const withQuery = (base, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  });
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
};

export const fetchCurrentStock = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/current-stock`, params), token);
export const fetchLowStock = async (token) => buildRequest(`${API_ROOT}/reports/low-stock`, token);
export const fetchStockMovement = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/stock-movement`, params), token);
export const fetchPurchaseSummary = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/purchase-summary`, params), token);
export const fetchProductionSummary = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/production-summary`, params), token);
export const fetchSalesSummary = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/sales-summary`, params), token);
export const fetchOutstanding = async (token) => buildRequest(`${API_ROOT}/reports/outstanding`, token);
export const fetchProfitLoss = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/profit-loss`, params), token);
export const fetchStockLedger = async (token, params) => buildRequest(withQuery(`${API_ROOT}/stock-ledger/ledger`, params), token);
export const fetchTaxSummary = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/tax-summary`, params), token);
export const fetchExpenseReport = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/expense-report`, params), token);
export const fetchCustomerStatement = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/customer-statement`, params), token);
export const fetchSupplierStatement = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/supplier-statement`, params), token);
export const fetchSalesBacklog = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/sales-backlog`, params), token);
export const fetchOpenPurchaseOrders = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/open-purchase-orders`, params), token);
export const fetchInventoryValuation = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/inventory-valuation`, params), token);
export const fetchSlowMovingStock = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/slow-moving-stock`, params), token);
export const fetchAbcAnalysis = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/abc-analysis`, params), token);
export const fetchStockTransferRegister = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/stock-transfer-register`, params), token);
export const fetchStockAdjustmentReport = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/stock-adjustment-report`, params), token);
export const fetchPoVarianceReport = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/po-variance`, params), token);
export const fetchSupplierPriceTrend = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/supplier-price-trend`, params), token);
export const fetchCashFlowStatement = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/cash-flow`, params), token);
export const fetchFundTransferRegister = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/fund-transfer-register`, params), token);
export const fetchDeliveryPerformance = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/delivery-performance`, params), token);
export const fetchDocumentRegister = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/document-register`, params), token);
export const fetchSalespersonPerformance = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/salesperson-performance`, params), token);
export const fetchSupplierScorecard = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/supplier-scorecard`, params), token);
export const fetchExpiryReport = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/expiry-report`, params), token);
export const fetchSalesReturnsReport = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/sales-returns`, params), token);
export const fetchPurchaseReturnsReport = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/purchase-returns`, params), token);
export const fetchChartOfAccounts = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/chart-of-accounts`, params), token);
export const fetchTrialBalance = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/trial-balance`, params), token);
export const fetchBalanceSheet = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/balance-sheet`, params), token);
export const fetchJournalRegister = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/journal-register`, params), token);
export const fetchSalesByCategory = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/sales-by-category`, params), token);
export const fetchPaymentMethodAnalysis = async (token, params) => buildRequest(withQuery(`${API_ROOT}/reports/payment-method-analysis`, params), token);

// Products, warehouses, customers and suppliers are shared lookups, reused rather than duplicated here.
export { fetchProducts, fetchWarehouses } from './procurementService';
export { fetchCustomers } from './salesService';
export { fetchSuppliers } from './procurementService';
