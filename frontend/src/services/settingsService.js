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

// Returns { key: value } rather than the raw row array - callers just want a lookup map.
export const fetchSettings = async (token) => {
  const rows = await buildRequest(`${API_ROOT}/misc/settings`, token);
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
};

export const updateSettings = async (token, settings) =>
  buildRequest(`${API_ROOT}/misc/settings`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
