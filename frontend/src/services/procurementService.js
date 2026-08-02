import { API_ROOT } from '../config/api';

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

// Purchase Orders
export const fetchPurchaseOrders = async (token, params = {}) => {
  const query = new URLSearchParams({
    page: '1',
    limit: '20',
    ...params,
  });
  return buildRequest(`${API_ROOT}/procurement/orders?${query.toString()}`, token);
};

export const fetchPurchaseOrderById = async (token, id) =>
  buildRequest(`${API_ROOT}/procurement/orders/${id}`, token);

export const createPurchaseOrder = async (token, payload) =>
  buildRequest(`${API_ROOT}/procurement/orders`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updatePurchaseOrder = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/procurement/orders/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deletePurchaseOrder = async (token, id) =>
  buildRequest(`${API_ROOT}/procurement/orders/${id}`, token, {
    method: 'DELETE',
  });

export const updatePurchaseOrderStatus = async (token, id, status) =>
  buildRequest(`${API_ROOT}/procurement/orders/${id}/status`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

export const getOrderForVoucherConversion = async (token, id) =>
  buildRequest(`${API_ROOT}/procurement/orders/${id}/convert`, token);

// Purchase Vouchers
export const fetchPurchaseVouchers = async (token, params = {}) => {
  const query = new URLSearchParams({
    page: '1',
    limit: '20',
    ...params,
  });
  return buildRequest(`${API_ROOT}/procurement/vouchers?${query.toString()}`, token);
};

export const fetchPurchaseVoucherById = async (token, id) =>
  buildRequest(`${API_ROOT}/procurement/vouchers/${id}`, token);

export const createPurchaseVoucher = async (token, payload) =>
  buildRequest(`${API_ROOT}/procurement/vouchers`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updatePurchaseVoucher = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/procurement/vouchers/${id}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deletePurchaseVoucher = async (token, id) =>
  buildRequest(`${API_ROOT}/procurement/vouchers/${id}`, token, {
    method: 'DELETE',
  });

// Purchase Returns / Debit Notes
export const fetchPurchaseReturns = async (token, params = {}) => {
  const query = new URLSearchParams({
    page: '1',
    limit: '20',
    ...params,
  });
  return buildRequest(`${API_ROOT}/procurement/returns?${query.toString()}`, token);
};

export const fetchPurchaseReturnById = async (token, id) =>
  buildRequest(`${API_ROOT}/procurement/returns/${id}`, token);

export const createPurchaseReturn = async (token, payload) =>
  buildRequest(`${API_ROOT}/procurement/returns`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deletePurchaseReturn = async (token, id) =>
  buildRequest(`${API_ROOT}/procurement/returns/${id}`, token, {
    method: 'DELETE',
  });

// Lookups
export const fetchProducts = async (token) => {
  const response = await buildRequest(`${API_ROOT}/master/products?page=1&limit=1000&search=&sortBy=name&order=ASC`, token);
  return response.data || [];
};

export const fetchSuppliers = async (token) => {
  const response = await buildRequest(`${API_ROOT}/master/suppliers?page=1&limit=1000&search=&sortBy=name&order=ASC`, token);
  return response.data || [];
};

export const fetchWarehouses = async (token) => {
  const response = await buildRequest(`${API_ROOT}/master/warehouses?page=1&limit=1000&search=&sortBy=name&order=ASC`, token);
  return response.data || [];
};

// Payment Methods
export const fetchPaymentMethods = async (token) => {
  const response = await buildRequest(`${API_ROOT}/master/payment-methods?page=1&limit=100&search=&sortBy=name&order=ASC`, token);
  return response.data || [];
};

// Accounts
export const fetchAccounts = async (token) => {
  const response = await buildRequest(`${API_ROOT}/master/accounts?page=1&limit=100&search=&sortBy=name&order=ASC`, token);
  return response.data || [];
};

// Payments
export const createPayment = async (token, payload) =>
  buildRequest(`${API_ROOT}/payments`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const fetchPayments = async (token, params = {}) => {
  const query = new URLSearchParams({
    page: '1', limit: '50', ...params,
  });
  return buildRequest(`${API_ROOT}/payments?${query.toString()}`, token);
};

export const deletePayment = async (token, id) =>
  buildRequest(`${API_ROOT}/payments/${id}`, token, {
    method: 'DELETE',
  });

// Self-reported audit entry for a client-side print action. Never allowed to
// disrupt printing itself, so failures are swallowed silently.
export const logPrintAction = async (token, payload) => {
  try {
    await buildRequest(`${API_ROOT}/audit/log-print`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore - printing already happened, this is best-effort logging
  }
};
