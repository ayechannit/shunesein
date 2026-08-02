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

// Production Batches
export const fetchProductionBatches = async (token, params = {}) => {
  const query = new URLSearchParams({ page: '1', limit: '20', ...params });
  return buildRequest(`${API_ROOT}/inventory/batches?${query.toString()}`, token);
};

export const fetchProductionBatchById = async (token, id) =>
  buildRequest(`${API_ROOT}/inventory/batches/${id}`, token);

export const createProductionBatch = async (token, payload) =>
  buildRequest(`${API_ROOT}/inventory/batches`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateProductionBatchStatus = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/inventory/batches/${id}/status`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

// Stock Transfers
export const fetchStockTransfers = async (token, params = {}) => {
  const query = new URLSearchParams({ page: '1', limit: '20', ...params });
  return buildRequest(`${API_ROOT}/inventory/transfers?${query.toString()}`, token);
};

export const fetchStockTransferById = async (token, id) =>
  buildRequest(`${API_ROOT}/inventory/transfers/${id}`, token);

export const createStockTransfer = async (token, payload) =>
  buildRequest(`${API_ROOT}/inventory/transfers`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateStockTransferStatus = async (token, id, status) =>
  buildRequest(`${API_ROOT}/inventory/transfers/${id}/status`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

// Stock Adjustments
export const fetchStockAdjustments = async (token, params = {}) => {
  const query = new URLSearchParams({ page: '1', limit: '20', ...params });
  return buildRequest(`${API_ROOT}/inventory/adjustments?${query.toString()}`, token);
};

export const fetchStockAdjustmentById = async (token, id) =>
  buildRequest(`${API_ROOT}/inventory/adjustments/${id}`, token);

export const createStockAdjustment = async (token, payload) =>
  buildRequest(`${API_ROOT}/inventory/adjustments`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

// Stock Count
export const fetchWarehouseStock = async (token, warehouseId) =>
  buildRequest(`${API_ROOT}/inventory/stock-levels?warehouse_id=${warehouseId}`, token);

export const submitStockCount = async (token, payload) =>
  buildRequest(`${API_ROOT}/misc/stock-count`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

// Products and warehouses are shared with Procurement - reused rather than duplicated here.
export { fetchProducts, fetchWarehouses } from './procurementService';

// Used to filter the product picker for Production: raw materials consumed
// must be "Raw Material" type, finished goods produced must be "Finished
// Goods" type. Read-only lookup - there is no create/edit/delete for product types.
export const fetchProductTypes = async (token) =>
  buildRequest(`${API_ROOT}/master/product-types?limit=100`, token);
