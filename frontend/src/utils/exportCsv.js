// Client-side CSV export shared by every report in Reports.jsx. Reports
// already hold their fetched data in state, so this converts what's already
// on screen rather than re-querying the server for a fresh export copy.

const BOM = '\uFEFF'; // so Excel opens the UTF-8 file without mangling non-ASCII text

const escapeCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

// columns: [{ key, label, value?: (row) => any }] - value() overrides reading row[key] directly.
export const downloadCsv = (filename, columns, rows) => {
  const header = columns.map((column) => escapeCsvValue(column.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(column.value ? column.value(row) : row[column.key])).join(',')
  );
  const blob = new Blob([BOM + [header, ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
