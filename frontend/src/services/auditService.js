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

export const fetchAuditLogs = async (token, params = {}) => {
  const query = new URLSearchParams();
  query.set('page', String(params.page || 1));
  query.set('limit', String(params.limit || 20));
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.order) query.set('order', params.order);
  if (params.search) query.set('search', params.search);
  if (params.user_id) query.set('user_id', params.user_id);
  if (params.target_table) query.set('target_table', params.target_table);
  if (params.action) query.set('action', params.action);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  return buildRequest(`${API_ROOT}/audit?${query.toString()}`, token);
};

export const fetchActivitySummary = async (token, params = {}) => {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const qs = query.toString();
  return buildRequest(`${API_ROOT}/audit/summary${qs ? `?${qs}` : ''}`, token);
};

export const fetchUsersForFilter = async (token) => {
  const response = await buildRequest(`${API_ROOT}/user-management/users?page=1&limit=1000&sortBy=username&order=ASC`, token);
  return response.data || [];
};
