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

// Income/Expense Categories (lookup only - full CRUD lives under Master Data)
export const fetchIncomeExpenseCategories = async (token) => {
  const response = await buildRequest(`${API_ROOT}/finance/categories?page=1&limit=1000&search=&sortBy=name&order=ASC`, token);
  return response.data || [];
};

// Income/Expense Entries
export const fetchEntries = async (token, params = {}) => {
  const query = new URLSearchParams({ page: '1', limit: '20', ...params });
  return buildRequest(`${API_ROOT}/finance/entries?${query.toString()}`, token);
};

export const createEntry = async (token, payload) =>
  buildRequest(`${API_ROOT}/finance/entries`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deleteEntry = async (token, id) =>
  buildRequest(`${API_ROOT}/finance/entries/${id}`, token, { method: 'DELETE' });

// Fund Transfers
export const fetchTransfers = async (token, params = {}) => {
  const query = new URLSearchParams({ page: '1', limit: '20', ...params });
  return buildRequest(`${API_ROOT}/finance/transfers?${query.toString()}`, token);
};

export const createTransfer = async (token, payload) =>
  buildRequest(`${API_ROOT}/finance/transfers`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deleteTransfer = async (token, id) =>
  buildRequest(`${API_ROOT}/finance/transfers/${id}`, token, { method: 'DELETE' });

// Cash Book / Bank Book
export const fetchAccountLedger = async (token, { account_id, from, to }) => {
  const query = new URLSearchParams({ account_id: String(account_id) });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  return buildRequest(`${API_ROOT}/finance/account-ledger?${query.toString()}`, token);
};

// Accounts are shared with Procurement - reused rather than duplicated here.
export { fetchAccounts } from './procurementService';
