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

export const fetchDeliveries = async (token, params = {}) => {
  const query = new URLSearchParams({ page: '1', limit: '20', ...params });
  return buildRequest(`${API_ROOT}/deliveries?${query.toString()}`, token);
};

export const createDelivery = async (token, payload) =>
  buildRequest(`${API_ROOT}/deliveries`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateDeliveryStatus = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/deliveries/${id}/status`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

// Sales invoices are shared with the Sales module - reused rather than duplicated here.
export { fetchSalesInvoices } from './salesService';
