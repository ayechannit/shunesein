// Shared print-document renderer used by Purchase Orders/Vouchers and Sale
// Orders/Invoices. Builds a proper business-document layout (letterhead,
// meta grid, styled items table, totals block) and applies the page size and
// margins configured under Settings > Print Page Setup via @page CSS.

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString();
};

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);

// pageSettings: { marginTop, marginBottom, marginLeft, marginRight, pageWidth, pageHeight } in mm
export const openPrintDocument = ({
  documentTypeLabel,
  documentNumber,
  partyLabel,
  partyName,
  date,
  statusLabel,
  extraMeta = [],
  items = [],
  totals = [],
  remark,
  pageSettings = {},
}) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    return false;
  }

  const pageSize = `${Number(pageSettings.pageWidth) || 210}mm ${Number(pageSettings.pageHeight) || 297}mm`;
  const pageMargin = `${Number(pageSettings.marginTop) || 15}mm ${Number(pageSettings.marginRight) || 10}mm ${Number(pageSettings.marginBottom) || 15}mm ${Number(pageSettings.marginLeft) || 10}mm`;

  const metaRows = [
    { label: partyLabel, value: partyName },
    { label: 'Date', value: formatDate(date) },
    { label: 'Status', value: statusLabel },
    ...extraMeta,
  ].filter((row) => row.value !== undefined && row.value !== null && row.value !== '');

  const itemsRows = items.map((item, index) => `
    <tr>
      <td class="col-index">${index + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="num">${formatNumber(item.quantity)}</td>
      <td class="num">${formatNumber(item.unitPrice)}</td>
      <td class="num">${formatNumber(item.subtotal)}</td>
    </tr>
  `).join('');

  const totalsRows = totals.map((row) => `
    <div class="totals-row ${row.emphasize ? 'totals-row-net' : ''}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${formatNumber(row.value)}</strong>
    </div>
  `).join('');

  printWindow.document.write(`
    <html>
    <head>
      <title>${escapeHtml(documentTypeLabel)} - ${escapeHtml(documentNumber)}</title>
      <style>
        @page { size: ${pageSize}; margin: ${pageMargin}; }
        * { box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          color: #1a1d23;
          margin: 0;
          padding: 0;
          font-size: 13px;
          line-height: 1.5;
        }
        .letterhead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #2563eb;
          padding-bottom: 14px;
          margin-bottom: 20px;
        }
        .brand { font-size: 20px; font-weight: 700; color: #2563eb; letter-spacing: -0.02em; }
        .brand-subtitle { font-size: 11px; color: #6b7280; margin-top: 2px; }
        .doc-title { text-align: right; }
        .doc-title h1 { margin: 0; font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
        .doc-title .doc-number { font-size: 14px; color: #2563eb; font-weight: 600; margin-top: 2px; }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px 24px;
          margin-bottom: 22px;
          padding: 14px 16px;
          background: #f8fafc;
          border-radius: 6px;
        }
        .meta-item { display: flex; flex-direction: column; gap: 2px; }
        .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; font-weight: 600; }
        .meta-value { font-size: 13px; font-weight: 500; }
        table.items { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        table.items th {
          background: #2563eb; color: #fff; text-align: left;
          padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
        }
        table.items th.num, table.items td.num { text-align: right; }
        table.items td.col-index { color: #9ca3af; width: 28px; }
        table.items td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
        table.items tbody tr:nth-child(even) { background: #f8fafc; }
        .totals-block { margin-left: auto; width: 260px; margin-bottom: 20px; }
        .totals-row { display: flex; justify-content: space-between; padding: 5px 2px; font-size: 13px; }
        .totals-row-net { border-top: 2px solid #1a1d23; margin-top: 4px; padding-top: 8px; font-size: 15px; }
        .totals-row-net strong { color: #2563eb; }
        .remark-block { margin-bottom: 20px; padding: 10px 14px; background: #f8fafc; border-left: 3px solid #2563eb; font-size: 12px; }
        .remark-block .meta-label { margin-bottom: 4px; }
        .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; display: flex; justify-content: space-between; }
      </style>
    </head>
    <body>
      <div class="letterhead">
        <div>
          <div class="brand">Ma Cherry</div>
          <div class="brand-subtitle">Tea Leaf &amp; Fried Bean Manufacturing</div>
        </div>
        <div class="doc-title">
          <h1>${escapeHtml(documentTypeLabel)}</h1>
          <div class="doc-number">${escapeHtml(documentNumber)}</div>
        </div>
      </div>

      <div class="meta-grid">
        ${metaRows.map((row) => `
          <div class="meta-item">
            <span class="meta-label">${escapeHtml(row.label)}</span>
            <span class="meta-value">${escapeHtml(row.value)}</span>
          </div>
        `).join('')}
      </div>

      ${items.length > 0 ? `
        <table class="items">
          <thead>
            <tr>
              <th></th>
              <th>Item</th>
              <th class="num">Quantity</th>
              <th class="num">Unit Price</th>
              <th class="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>
      ` : ''}

      ${totals.length > 0 ? `<div class="totals-block">${totalsRows}</div>` : ''}

      ${remark ? `
        <div class="remark-block">
          <div class="meta-label">Remark</div>
          <div>${escapeHtml(remark)}</div>
        </div>
      ` : ''}

      <div class="footer">
        <span>Generated by Shunesein ERP</span>
        <span>${new Date().toLocaleString()}</span>
      </div>
      <script>window.print();</script>
    </body>
    </html>
  `);
  printWindow.document.close();
  return true;
};
