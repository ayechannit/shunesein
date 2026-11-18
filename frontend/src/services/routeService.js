import { API_ROOT } from '../config/api';

// Route (van / motorcycle) sales - see backend RouteController.

const buildRequest = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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

export const fetchVehicles = async (token) => {
  const response = await buildRequest(`${API_ROOT}/route/vehicles?page=1&limit=1000&sortBy=name&order=ASC`, token);
  return response.data || [];
};

export const fetchTrips = async (token, params = {}) => {
  const query = new URLSearchParams({ page: '1', limit: '10', ...params });
  return buildRequest(`${API_ROOT}/route/trips?${query.toString()}`, token);
};

export const fetchOpenTrips = async (token) => {
  const response = await buildRequest(`${API_ROOT}/route/trips/open`, token);
  return response.data || [];
};

export const fetchTrip = async (token, id) => buildRequest(`${API_ROOT}/route/trips/${id}`, token);

export const createTrip = async (token, payload) =>
  buildRequest(`${API_ROOT}/route/trips`, token, { method: 'POST', body: JSON.stringify(payload) });

export const loadMoreStock = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/route/trips/${id}/load`, token, { method: 'POST', body: JSON.stringify(payload) });

export const setTripInvoices = async (token, id, invoiceIds) =>
  buildRequest(`${API_ROOT}/route/trips/${id}/invoices`, token, { method: 'PUT', body: JSON.stringify({ invoice_ids: invoiceIds }) });

export const deleteTrip = async (token, id) =>
  buildRequest(`${API_ROOT}/route/trips/${id}`, token, { method: 'DELETE' });

export const settleTrip = async (token, id, payload) =>
  buildRequest(`${API_ROOT}/route/trips/${id}/settle`, token, { method: 'POST', body: JSON.stringify(payload) });

export const fetchStaffBalances = async (token) => buildRequest(`${API_ROOT}/route/staff-balances`, token);

export const recordStaffRepayment = async (token, payload) =>
  buildRequest(`${API_ROOT}/route/staff-balances/repay`, token, { method: 'POST', body: JSON.stringify(payload) });
