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

// Sale Orders
export const fetchSaleOrders = async (token, params = {}) => {
  const query = new URLSearchParams({
    page: '1',
    limit: '20',
    ...params,
  });
  return buildRequest(`${API_ROOT}/sales/orders?${query.toString()}`, token);
};

export const fetchSaleOrderById = async (token, id) =>
  buildRequest(`${API_ROOT}/sales/orders/${id}`, token);

export const createSaleOrder = async (token, payload) =>
  buildRequest(`${API_ROOT}/sales/orders`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateSaleOrder = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/sales/orders/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deleteSaleOrder = async (token, id) =>
  buildRequest(`${API_ROOT}/sales/orders/${id}`, token, {
    method: 'DELETE',
  });

export const updateSaleOrderStatus = async (token, id, status) =>
  buildRequest(`${API_ROOT}/sales/orders/${id}/status`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

export const getOrderForInvoiceConversion = async (token, id) =>
  buildRequest(`${API_ROOT}/sales/orders/${id}/convert`, token);

// Sales Invoices
export const fetchSalesInvoices = async (token, params = {}) => {
  const query = new URLSearchParams({
    page: '1',
    limit: '20',
    ...params,
  });
  return buildRequest(`${API_ROOT}/sales/invoices?${query.toString()}`, token);
};

export const fetchSalesInvoiceById = async (token, id) =>
  buildRequest(`${API_ROOT}/sales/invoices/${id}`, token);

export const createSalesInvoice = async (token, payload) =>
  buildRequest(`${API_ROOT}/sales/invoices`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateSalesInvoice = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/sales/invoices/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deleteSalesInvoice = async (token, id) =>
  buildRequest(`${API_ROOT}/sales/invoices/${id}`, token, {
    method: 'DELETE',
  });

// Lookups
export const fetchCustomers = async (token) => {
  const response = await buildRequest(`${API_ROOT}/master/customers?page=1&limit=1000&search=&sortBy=name&order=ASC`, token);
  return response.data || [];
};

// Products, warehouses, payment methods, accounts, and payment recording are
// shared with Procurement - reused rather than duplicated here.
export {
  fetchProducts,
  fetchWarehouses,
  fetchPaymentMethods,
  fetchAccounts,
  createPayment,
  fetchPayments,
  deletePayment,
  logPrintAction,
} from './procurementService';
