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

// Every named print page setup (margins + page size). Small, fixed-ish
// list - fetched in full rather than paginated, since every print flow
// needs the whole set to build a "choose a setup" dropdown.
export const fetchPrintPageSetups = async (token) => {
  const response = await buildRequest(`${API_ROOT}/master/print-page-setups?page=1&limit=1000&sortBy=name&order=ASC`, token);
  return response.data || [];
};

export const setDefaultPrintPageSetup = async (token, id) =>
  buildRequest(`${API_ROOT}/master/print-page-setups/${id}/set-default`, token, { method: 'POST' });

// Maps a DB row (margin_top, page_width, ...) to the shape openPrintDocument/
// openPrintList expect (marginTop, pageWidth, ...).
export const toPageSettings = (setup) => (setup ? {
  marginTop: setup.margin_top,
  marginBottom: setup.margin_bottom,
  marginLeft: setup.margin_left,
  marginRight: setup.margin_right,
  pageWidth: setup.page_width,
  pageHeight: setup.page_height,
} : {});
