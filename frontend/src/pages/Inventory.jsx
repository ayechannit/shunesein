import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/Procurement.css';
import {
  AppButton,
  DataTable,
  EmptyState,
  MasterModal,
  PageHeader,
  Pagination,
  PlusIcon,
  RefreshIcon,
  SearchToolbar,
  StatusBadge,
  EyeIcon,
  CheckIcon,
  XCircleIcon,
  SearchableSelect,
  UploadIcon,
  DownloadIcon,
  PrinterIcon,
} from '../components/masterData/MasterDataPrimitives';
import {
  fetchProductionBatches,
  fetchProductionBatchById,
  createProductionBatch,
  updateProductionBatchStatus,
  fetchStockTransfers,
  fetchStockTransferById,
  createStockTransfer,
  updateStockTransferStatus,
  fetchStockAdjustments,
  fetchStockAdjustmentById,
  createStockAdjustment,
  fetchWarehouseStock,
  submitStockCount,
  fetchProducts,
  fetchWarehouses,
  fetchProductTypes,
} from '../services/inventoryService';
import { fetchPrintPageSetups, toPageSettings } from '../services/printSetupService';
import { openPrintList } from '../utils/printDocument';
import { formatDate, formatDateTime, todayLocal as today } from '../utils/datetime';

const PAGE_SIZES = [5, 10, 20, 50];

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

// Minimal CSV helpers for the Stock Count export/import round trip - this
// isn't table data going through the server-side master-data CSV pipeline,
// just a browser-side "download a sheet, fill it in, upload it back" flow, so
// it's self-contained here rather than reusing that unrelated pipeline.
const csvEscapeField = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const toCsv = (headers, rows) => {
  const lines = [headers.map(csvEscapeField).join(',')];
  rows.forEach((row) => lines.push(row.map(csvEscapeField).join(',')));
  return lines.join('\r\n');
};

const downloadCsv = (filename, csvContent) => {
  // Leading UTF-8 BOM so Excel opens the file as UTF-8 instead of guessing a
  // local codepage - without it, non-ASCII product names render as mojibake.
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// Handles quoted fields (so a product name containing a comma survives the
// round trip) - a naive split(',') would silently corrupt those rows.
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((cell) => cell.trim() !== '')).map((r) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = r[index] !== undefined ? r[index].trim() : ''; });
    return record;
  });
};

const ADJUSTMENT_TYPES = [
  { value: 'damaged', label: 'Damaged Goods' },
  { value: 'missing', label: 'Missing Stock' },
  { value: 'expired', label: 'Expired Products' },
  { value: 'manual', label: 'Manual Adjustment' },
];

const Inventory = ({ token, onLogout, embedded = false, defaultTab = 'batches' }) => {
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const menuRef = useRef(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [pageSuccess, setPageSuccess] = useState('');
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [productData, warehouseData, productTypeData] = await Promise.all([
          fetchProducts(token),
          fetchWarehouses(token),
          fetchProductTypes(token),
        ]);
        setProducts(productData);
        setWarehouses(warehouseData);
        setProductTypes(productTypeData.data || []);
      } catch {
        // ignore lookup errors for now
      }
    };
    loadLookups();
  }, [token]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!pageSuccess) return;
    const timer = setTimeout(() => setPageSuccess(''), 3000);
    return () => clearTimeout(timer);
  }, [pageSuccess]);

  const productMap = useMemo(() => products.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [products]);

  const productTypeNameById = useMemo(
    () => productTypes.reduce((acc, pt) => { acc[pt.id] = pt.name; return acc; }, {}),
    [productTypes]
  );

  const productOptions = useMemo(
    () => products.map((p) => ({ value: String(p.id), label: p.name })),
    [products]
  );

  const rawMaterialOptions = useMemo(
    () => products
      .filter((p) => productTypeNameById[p.product_type_id] === 'Raw Material')
      .map((p) => ({ value: String(p.id), label: p.name })),
    [products, productTypeNameById]
  );

  const finishedGoodOptions = useMemo(
    () => products
      .filter((p) => productTypeNameById[p.product_type_id] === 'Finished Goods')
      .map((p) => ({ value: String(p.id), label: p.name })),
    [products, productTypeNameById]
  );

  const shared = {
    token, onLogout, products, productMap, warehouses, menuRef, menuOpenId, setMenuOpenId, pageSuccess, setPageSuccess, pageError, setPageError,
    productOptions, rawMaterialOptions, finishedGoodOptions,
  };

  const titleFor = {
    batches: { title: 'Production Batches', description: 'Log production runs and track raw material usage.' },
    transfers: { title: 'Stock Transfers', description: 'Move inventory between warehouses.' },
    adjustments: { title: 'Stock Adjustments', description: 'Record damaged, missing, expired, or manually corrected stock.' },
    'stock-count': { title: 'Stock Count', description: 'Compare physical counts to system stock and reconcile discrepancies.' },
  }[defaultTab] || { title: 'Inventory', description: '' };

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Inventory', titleFor.title]} title={titleFor.title} description={titleFor.description} actions={null} /> : null}
      {pageSuccess ? <div className="status-banner status-banner-success status-banner-autodismiss" style={{ marginBottom: '1rem' }}>{pageSuccess}</div> : null}
      {pageError ? <div className="status-banner status-banner-error" style={{ marginBottom: '1rem' }}>{pageError}</div> : null}

      {defaultTab === 'batches' && <ProductionBatchesTab {...shared} />}
      {defaultTab === 'transfers' && <StockTransfersTab {...shared} />}
      {defaultTab === 'adjustments' && <StockAdjustmentsTab {...shared} />}
      {defaultTab === 'stock-count' && <StockCountTab {...shared} />}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

// ─────────────────────────── Production Batches ───────────────────────────

const emptyBatchForm = () => ({
  batch_number: '',
  remark: '',
  raw_materials: [{ product_id: '', warehouse_id: '', quantity: '1', unit_cost: '0' }],
});

const ProductionBatchesTab = ({ token, onLogout, warehouses, rawMaterialOptions, finishedGoodOptions, menuRef, menuOpenId, setMenuOpenId, setPageSuccess, setPageError }) => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('id-desc');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState(emptyBatchForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [viewRecord, setViewRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [completeTarget, setCompleteTarget] = useState(null);
  const [completeItems, setCompleteItems] = useState([{ product_id: '', warehouse_id: '', quantity: '1', unit_cost: '0' }]);
  const [completeError, setCompleteError] = useState('');
  const [completeSaving, setCompleteSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchProductionBatches(token, { page, limit: pageSize, search, sortBy: sort.split('-')[0], order: sort.split('-')[1].toUpperCase() });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load production batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, search, sort]);

  const updateRawItem = (index, key, value) => {
    setFormValues((prev) => {
      const items = [...prev.raw_materials];
      items[index] = { ...items[index], [key]: value };
      return { ...prev, raw_materials: items };
    });
  };
  const addRawItem = () => setFormValues((prev) => ({ ...prev, raw_materials: [...prev.raw_materials, { product_id: '', warehouse_id: '', quantity: '1', unit_cost: '0' }] }));
  const removeRawItem = (index) => setFormValues((prev) => ({ ...prev, raw_materials: prev.raw_materials.filter((_, i) => i !== index) }));

  const openCreate = () => {
    setFormValues(emptyBatchForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); load(); };

  const submitForm = async () => {
    const errors = {};
    formValues.raw_materials.forEach((item, index) => {
      if (!item.product_id) errors[`rm-product-${index}`] = 'Product is required.';
      if (!item.warehouse_id) errors[`rm-warehouse-${index}`] = 'Warehouse is required.';
      if (!item.quantity || Number(item.quantity) <= 0) errors[`rm-quantity-${index}`] = 'Quantity must be greater than 0.';
    });
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await createProductionBatch(token, {
        batch_number: formValues.batch_number || `BATCH-${Date.now()}`,
        remark: formValues.remark,
        raw_materials: formValues.raw_materials.map((item) => ({
          product_id: Number(item.product_id),
          warehouse_id: Number(item.warehouse_id),
          quantity: Number(item.quantity),
          unit_cost: item.unit_cost ? Number(item.unit_cost) : null,
        })),
      });
      setPageSuccess('Production batch created.');
      setFormOpen(false);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setFormErrors({ submit: error.message || 'Unable to save batch.' });
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (row) => {
    setMenuOpenId(null);
    setViewRecord(row);
    setViewLoading(true);
    try {
      const data = await fetchProductionBatchById(token, row.id);
      setViewRecord(data);
    } catch (error) {
      if (error.status === 401) return onLogout();
      setPageError(error.message || 'Unable to load batch details');
    } finally {
      setViewLoading(false);
    }
  };

  const handleStart = async (row) => {
    setMenuOpenId(null);
    try {
      await updateProductionBatchStatus(token, row.id, { status: 'in_progress' });
      setPageSuccess('Batch moved to in progress.');
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setPageError(error.message || 'Unable to start batch');
    }
  };

  const handleCancel = async (row) => {
    setMenuOpenId(null);
    try {
      await updateProductionBatchStatus(token, row.id, { status: 'cancelled' });
      setPageSuccess('Batch cancelled.');
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setPageError(error.message || 'Unable to cancel batch');
    }
  };

  const openComplete = (row) => {
    setMenuOpenId(null);
    setCompleteTarget(row);
    setCompleteItems([{ product_id: '', warehouse_id: '', quantity: '1', unit_cost: '0', lot_number: '', expiry_date: '' }]);
    setCompleteError('');
  };

  const updateCompleteItem = (index, key, value) => {
    setCompleteItems((prev) => {
      const items = [...prev];
      items[index] = { ...items[index], [key]: value };
      return items;
    });
  };
  const addCompleteItem = () => setCompleteItems((prev) => [...prev, { product_id: '', warehouse_id: '', quantity: '1', unit_cost: '0', lot_number: '', expiry_date: '' }]);
  const removeCompleteItem = (index) => setCompleteItems((prev) => prev.filter((_, i) => i !== index));

  const submitComplete = async () => {
    const invalid = completeItems.some((item) => !item.product_id || !item.warehouse_id || !item.quantity || Number(item.quantity) <= 0);
    if (invalid) {
      setCompleteError('Every finished good needs a product, warehouse, and a quantity greater than zero.');
      return;
    }
    setCompleteSaving(true);
    setCompleteError('');
    try {
      await updateProductionBatchStatus(token, completeTarget.id, {
        status: 'completed',
        finished_goods: completeItems.map((item) => ({
          product_id: Number(item.product_id),
          warehouse_id: Number(item.warehouse_id),
          quantity: Number(item.quantity),
          unit_cost: item.unit_cost ? Number(item.unit_cost) : null,
          lot_number: item.lot_number || null,
          expiry_date: item.expiry_date || null,
        })),
      });
      setPageSuccess('Batch completed.');
      setCompleteTarget(null);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setCompleteError(error.message || 'Unable to complete batch');
    } finally {
      setCompleteSaving(false);
    }
  };

  const columns = [
    { key: 'batch_number', label: 'Batch Number', sortable: true },
    { key: 'status', label: 'Status' },
    { key: 'start_date', label: 'Start Date' },
    { key: 'end_date', label: 'End Date' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'status') return <StatusBadge value={row.status} />;
    if (column.key === 'start_date') return formatDateTime(row.start_date);
    if (column.key === 'end_date') return formatDateTime(row.end_date);
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => {
    const status = row.status;
    return (
      <div className="dropdown-menu-list">
        <button type="button" className="dropdown-menu-item" onClick={() => handleView(row)}><EyeIcon className="menu-icon" /><span>View</span></button>
        {status === 'pending' && <button type="button" className="dropdown-menu-item" onClick={() => handleStart(row)}><CheckIcon className="menu-icon" /><span>Start Production</span></button>}
        {status === 'in_progress' && <button type="button" className="dropdown-menu-item" onClick={() => openComplete(row)}><CheckIcon className="menu-icon" /><span>Complete</span></button>}
        {(status === 'pending' || status === 'in_progress') && <button type="button" className="dropdown-menu-item danger" onClick={() => handleCancel(row)}><XCircleIcon className="menu-icon" /><span>Cancel</span></button>}
      </div>
    );
  };

  return (
    <div className="procurement-shell">
      {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}
      <div className="procurement-toolbar">
        <SearchToolbar
          searchValue={search}
          onSearchValueChange={setSearch}
          onSubmit={() => setPage(1)}
          onReset={() => { setSearch(''); setPage(1); }}
          sortValue={sort}
          onSortChange={setSort}
          sortOptions={[
            { label: 'Newest first', value: 'id-desc' },
            { label: 'Oldest first', value: 'id-asc' },
            { label: 'Batch Number A-Z', value: 'batch_number-asc' },
            { label: 'Batch Number Z-A', value: 'batch_number-desc' },
          ]}
          extraActions={<button type="button" className="master-button master-button-secondary" onClick={load} title="Refresh"><RefreshIcon className="button-icon" /><span>Refresh</span></button>}
        />
        <div className="procurement-actions">
          <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>New Production Batch</AppButton>
        </div>
      </div>

      <div className="procurement-card">
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowActions={[]}
          onEdit={() => {}}
          onDelete={() => {}}
          renderRowActions={renderActions}
          menuOpenId={menuOpenId}
          onToggleMenu={setMenuOpenId}
          menuRef={menuRef}
          emptyState={<EmptyState title="No production batches yet" description="Log a production run to get started." actionLabel="New Production Batch" onAction={openCreate} />}
          renderCell={renderCell}
        />
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
      </div>

      {formOpen ? (
        <MasterModal
          size="wide"
          title="New Production Batch"
          description="Declare the raw materials this batch will consume."
          onClose={closeForm}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
            <div className="procurement-grid">
              <div className="form-field">
                <label>Batch Number</label>
                <input type="text" value={formValues.batch_number} placeholder={`BATCH-${Date.now()}`} onChange={(e) => setFormValues((p) => ({ ...p, batch_number: e.target.value }))} />
              </div>
              <div className="form-field form-field-full">
                <label>Remark</label>
                <input type="text" value={formValues.remark} onChange={(e) => setFormValues((p) => ({ ...p, remark: e.target.value }))} placeholder="Optional note" />
              </div>
            </div>

            <div className="procurement-card">
              <div className="procurement-toolbar">
                <strong>Raw Materials</strong>
                <AppButton variant="secondary" onClick={addRawItem}>Add Item</AppButton>
              </div>
              <table className="procurement-items-table">
                <thead><tr><th>Product</th><th>Source Warehouse</th><th>Quantity</th><th>Unit Cost</th><th></th></tr></thead>
                <tbody>
                  {formValues.raw_materials.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <SearchableSelect
                          value={item.product_id}
                          onChange={(newValue) => updateRawItem(index, 'product_id', newValue)}
                          options={rawMaterialOptions}
                          placeholder="Select raw material"
                          searchPlaceholder="Search raw materials..."
                        />
                        {formErrors[`rm-product-${index}`] ? <div className="field-error">{formErrors[`rm-product-${index}`]}</div> : null}
                      </td>
                      <td>
                        <select value={item.warehouse_id} onChange={(e) => updateRawItem(index, 'warehouse_id', e.target.value)}>
                          <option value="">Select warehouse</option>
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                        {formErrors[`rm-warehouse-${index}`] ? <div className="field-error">{formErrors[`rm-warehouse-${index}`]}</div> : null}
                      </td>
                      <td><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateRawItem(index, 'quantity', e.target.value)} /></td>
                      <td><input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(e) => updateRawItem(index, 'unit_cost', e.target.value)} /></td>
                      <td>
                        <button type="button" className="item-remove-btn" onClick={() => removeRawItem(index)} title="Remove item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {viewRecord ? (
        <MasterModal
          size="wide"
          title={`Production Batch: ${viewRecord.batch_number}`}
          description="View production batch details"
          onClose={() => setViewRecord(null)}
          footer={<button type="button" className="master-button master-button-secondary" onClick={() => setViewRecord(null)}>Close</button>}
        >
          {viewLoading ? <div className="status-banner">Loading...</div> : (
            <div className="procurement-shell">
              <div className="record-summary-header">
                <div className="record-summary-meta">
                  <StatusBadge value={viewRecord.status} />
                  <span className="record-summary-date">{formatDateTime(viewRecord.start_date)}</span>
                </div>
              </div>
              <div className="detail-grid">
                {viewRecord.created_by_name && <div className="detail-item"><span className="detail-label">Created by</span><span className="detail-value">{viewRecord.created_by_name}</span></div>}
                <div className="detail-item"><span className="detail-label">Ended</span><span className="detail-value">{formatDateTime(viewRecord.end_date)}</span></div>
                {viewRecord.remark && <div className="detail-item detail-item-full"><span className="detail-label">Remark</span><span className="detail-value">{viewRecord.remark}</span></div>}
              </div>

              <div className="procurement-card">
                <strong>Raw Materials</strong>
                {(viewRecord.raw_materials || []).length > 0 ? (
                  <table className="procurement-items-table">
                    <thead><tr><th>Product</th><th>Warehouse</th><th>Quantity</th><th>Unit Cost</th></tr></thead>
                    <tbody>
                      {viewRecord.raw_materials.map((item) => (
                        <tr key={item.id}><td>{item.product_name || `Product #${item.product_id}`}</td><td>{item.warehouse_name || '-'}</td><td>{formatNumber(item.quantity)}</td><td>{formatNumber(item.unit_cost)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="payment-history-empty">No raw materials recorded.</p>}
              </div>

              <div className="procurement-card" style={{ marginTop: '1rem' }}>
                <strong>Finished Goods</strong>
                {(viewRecord.finished_goods || []).length > 0 ? (
                  <table className="procurement-items-table">
                    <thead><tr><th>Product</th><th>Warehouse</th><th>Quantity</th><th>Unit Cost</th><th>Lot #</th><th>Expiry Date</th></tr></thead>
                    <tbody>
                      {viewRecord.finished_goods.map((item) => (
                        <tr key={item.id}>
                          <td>{item.product_name || `Product #${item.product_id}`}</td>
                          <td>{item.warehouse_name || '-'}</td>
                          <td>{formatNumber(item.quantity)}</td>
                          <td>{formatNumber(item.unit_cost)}</td>
                          <td>{item.lot_number || '-'}</td>
                          <td>{item.expiry_date ? formatDate(item.expiry_date) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="payment-history-empty">Not completed yet.</p>}
              </div>
            </div>
          )}
        </MasterModal>
      ) : null}

      {completeTarget ? (
        <MasterModal
          size="wide"
          title={`Complete Batch: ${completeTarget.batch_number}`}
          description="Record the finished goods this batch produced."
          onClose={() => setCompleteTarget(null)}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={() => setCompleteTarget(null)}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitComplete} disabled={completeSaving}>{completeSaving ? 'Saving...' : 'Complete Batch'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {completeError ? <div className="status-banner status-banner-error">{completeError}</div> : null}
            <div className="procurement-card">
              <div className="procurement-toolbar">
                <strong>Finished Goods</strong>
                <AppButton variant="secondary" onClick={addCompleteItem}>Add Item</AppButton>
              </div>
              <table className="procurement-items-table">
                <thead><tr><th>Product</th><th>Destination Warehouse</th><th>Quantity</th><th>Unit Cost</th><th>Lot #</th><th>Expiry Date</th><th></th></tr></thead>
                <tbody>
                  {completeItems.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <SearchableSelect
                          value={item.product_id}
                          onChange={(newValue) => updateCompleteItem(index, 'product_id', newValue)}
                          options={finishedGoodOptions}
                          placeholder="Select finished good"
                          searchPlaceholder="Search finished goods..."
                        />
                      </td>
                      <td>
                        <select value={item.warehouse_id} onChange={(e) => updateCompleteItem(index, 'warehouse_id', e.target.value)}>
                          <option value="">Select warehouse</option>
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </td>
                      <td><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateCompleteItem(index, 'quantity', e.target.value)} /></td>
                      <td><input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(e) => updateCompleteItem(index, 'unit_cost', e.target.value)} /></td>
                      <td><input type="text" value={item.lot_number || ''} onChange={(e) => updateCompleteItem(index, 'lot_number', e.target.value)} placeholder="Optional" /></td>
                      <td><input type="date" value={item.expiry_date || ''} onChange={(e) => updateCompleteItem(index, 'expiry_date', e.target.value)} /></td>
                      <td>
                        <button type="button" className="item-remove-btn" onClick={() => removeCompleteItem(index)} title="Remove item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </MasterModal>
      ) : null}
    </div>
  );
};

// ─────────────────────────── Stock Transfers ───────────────────────────

const emptyTransferForm = () => ({
  transfer_number: '',
  from_warehouse_id: '',
  to_warehouse_id: '',
  date: today(),
  remark: '',
  items: [{ product_id: '', quantity: '1' }],
});

const TRANSFER_NEXT_STATUS = { pending: 'approved', approved: 'received', received: 'completed' };
const TRANSFER_ACTION_LABEL = { pending: 'Approve', approved: 'Mark Received', received: 'Mark Completed' };

const StockTransfersTab = ({ token, onLogout, warehouses, productOptions, menuRef, menuOpenId, setMenuOpenId, setPageSuccess, setPageError }) => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('id-desc');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState(emptyTransferForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [viewRecord, setViewRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchStockTransfers(token, { page, limit: pageSize, search, sortBy: sort.split('-')[0], order: sort.split('-')[1].toUpperCase() });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load stock transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, search, sort]);

  const updateItem = (index, key, value) => {
    setFormValues((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [key]: value };
      return { ...prev, items };
    });
  };
  const addItem = () => setFormValues((prev) => ({ ...prev, items: [...prev.items, { product_id: '', quantity: '1' }] }));
  const removeItem = (index) => setFormValues((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));

  const openCreate = () => {
    setFormValues(emptyTransferForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); load(); };

  const submitForm = async () => {
    const errors = {};
    if (!formValues.from_warehouse_id) errors.from_warehouse_id = 'Source warehouse is required.';
    if (!formValues.to_warehouse_id) errors.to_warehouse_id = 'Destination warehouse is required.';
    if (formValues.from_warehouse_id && formValues.from_warehouse_id === formValues.to_warehouse_id) errors.to_warehouse_id = 'Destination must differ from source.';
    formValues.items.forEach((item, index) => {
      if (!item.product_id) errors[`item-product-${index}`] = 'Product is required.';
      if (!item.quantity || Number(item.quantity) <= 0) errors[`item-quantity-${index}`] = 'Quantity must be greater than 0.';
    });
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await createStockTransfer(token, {
        transfer_number: formValues.transfer_number || `TR-${Date.now()}`,
        from_warehouse_id: Number(formValues.from_warehouse_id),
        to_warehouse_id: Number(formValues.to_warehouse_id),
        date: formValues.date || new Date().toISOString().slice(0, 10),
        remark: formValues.remark,
        items: formValues.items.map((item) => ({ product_id: Number(item.product_id), quantity: Number(item.quantity) })),
      });
      setPageSuccess('Stock transfer created.');
      setFormOpen(false);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setFormErrors({ submit: error.message || 'Unable to save transfer.' });
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (row) => {
    setMenuOpenId(null);
    setViewRecord(row);
    setViewLoading(true);
    try {
      const data = await fetchStockTransferById(token, row.id);
      setViewRecord(data);
    } catch (error) {
      if (error.status === 401) return onLogout();
      setPageError(error.message || 'Unable to load transfer details');
    } finally {
      setViewLoading(false);
    }
  };

  const handleAdvance = async (row) => {
    setMenuOpenId(null);
    const nextStatus = TRANSFER_NEXT_STATUS[row.status];
    if (!nextStatus) return;
    try {
      await updateStockTransferStatus(token, row.id, nextStatus);
      setPageSuccess(`Transfer moved to ${nextStatus}.`);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setPageError(error.message || 'Unable to update transfer status');
    }
  };

  const columns = [
    { key: 'transfer_number', label: 'Transfer Number', sortable: true },
    { key: 'from_warehouse_name', label: 'From' },
    { key: 'to_warehouse_name', label: 'To' },
    { key: 'date', label: 'Date' },
    { key: 'status', label: 'Status' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'status') return <StatusBadge value={row.status} />;
    if (column.key === 'date') return formatDate(row.date);
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => {
    const nextLabel = TRANSFER_ACTION_LABEL[row.status];
    return (
      <div className="dropdown-menu-list">
        <button type="button" className="dropdown-menu-item" onClick={() => handleView(row)}><EyeIcon className="menu-icon" /><span>View</span></button>
        {nextLabel && <button type="button" className="dropdown-menu-item" onClick={() => handleAdvance(row)}><CheckIcon className="menu-icon" /><span>{nextLabel}</span></button>}
      </div>
    );
  };

  return (
    <div className="procurement-shell">
      {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}
      <div className="procurement-toolbar">
        <SearchToolbar
          searchValue={search}
          onSearchValueChange={setSearch}
          onSubmit={() => setPage(1)}
          onReset={() => { setSearch(''); setPage(1); }}
          sortValue={sort}
          onSortChange={setSort}
          sortOptions={[
            { label: 'Newest first', value: 'id-desc' },
            { label: 'Oldest first', value: 'id-asc' },
            { label: 'Transfer Number A-Z', value: 'transfer_number-asc' },
            { label: 'Transfer Number Z-A', value: 'transfer_number-desc' },
          ]}
          extraActions={<button type="button" className="master-button master-button-secondary" onClick={load} title="Refresh"><RefreshIcon className="button-icon" /><span>Refresh</span></button>}
        />
        <div className="procurement-actions">
          <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>New Stock Transfer</AppButton>
        </div>
      </div>

      <div className="procurement-card">
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowActions={[]}
          onEdit={() => {}}
          onDelete={() => {}}
          renderRowActions={renderActions}
          menuOpenId={menuOpenId}
          onToggleMenu={setMenuOpenId}
          menuRef={menuRef}
          emptyState={<EmptyState title="No stock transfers yet" description="Create a transfer to move inventory between warehouses." actionLabel="New Stock Transfer" onAction={openCreate} />}
          renderCell={renderCell}
        />
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
      </div>

      {formOpen ? (
        <MasterModal
          size="wide"
          title="New Stock Transfer"
          description="Move items from one warehouse to another."
          onClose={closeForm}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
            <div className="procurement-grid">
              <div className="form-field">
                <label>Transfer Number</label>
                <input type="text" value={formValues.transfer_number} placeholder={`TR-${Date.now()}`} onChange={(e) => setFormValues((p) => ({ ...p, transfer_number: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>Date</label>
                <input type="date" value={formValues.date} onChange={(e) => setFormValues((p) => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>From Warehouse *</label>
                <select value={formValues.from_warehouse_id} onChange={(e) => setFormValues((p) => ({ ...p, from_warehouse_id: e.target.value }))}>
                  <option value="">Select warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {formErrors.from_warehouse_id ? <div className="field-error">{formErrors.from_warehouse_id}</div> : null}
              </div>
              <div className="form-field">
                <label>To Warehouse *</label>
                <select value={formValues.to_warehouse_id} onChange={(e) => setFormValues((p) => ({ ...p, to_warehouse_id: e.target.value }))}>
                  <option value="">Select warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {formErrors.to_warehouse_id ? <div className="field-error">{formErrors.to_warehouse_id}</div> : null}
              </div>
              <div className="form-field form-field-full">
                <label>Remark</label>
                <input type="text" value={formValues.remark} onChange={(e) => setFormValues((p) => ({ ...p, remark: e.target.value }))} placeholder="Optional note" />
              </div>
            </div>

            <div className="procurement-card">
              <div className="procurement-toolbar">
                <strong>Items</strong>
                <AppButton variant="secondary" onClick={addItem}>Add Item</AppButton>
              </div>
              <table className="procurement-items-table">
                <thead><tr><th>Product</th><th>Quantity</th><th></th></tr></thead>
                <tbody>
                  {formValues.items.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <SearchableSelect
                          value={item.product_id}
                          onChange={(newValue) => updateItem(index, 'product_id', newValue)}
                          options={productOptions}
                          placeholder="Select product"
                          searchPlaceholder="Search products..."
                        />
                        {formErrors[`item-product-${index}`] ? <div className="field-error">{formErrors[`item-product-${index}`]}</div> : null}
                      </td>
                      <td><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} /></td>
                      <td>
                        <button type="button" className="item-remove-btn" onClick={() => removeItem(index)} title="Remove item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {viewRecord ? (
        <MasterModal
          size="wide"
          title={`Stock Transfer: ${viewRecord.transfer_number}`}
          description="View stock transfer details"
          onClose={() => setViewRecord(null)}
          footer={<button type="button" className="master-button master-button-secondary" onClick={() => setViewRecord(null)}>Close</button>}
        >
          {viewLoading ? <div className="status-banner">Loading...</div> : (
            <div className="procurement-shell">
              <div className="record-summary-header">
                <div className="record-summary-meta">
                  <StatusBadge value={viewRecord.status} />
                  <span className="record-summary-date">{formatDate(viewRecord.date)}</span>
                </div>
              </div>
              <div className="detail-grid">
                <div className="detail-item"><span className="detail-label">From</span><span className="detail-value">{viewRecord.from_warehouse_name || '-'}</span></div>
                <div className="detail-item"><span className="detail-label">To</span><span className="detail-value">{viewRecord.to_warehouse_name || '-'}</span></div>
                {viewRecord.created_by_name && <div className="detail-item"><span className="detail-label">Created by</span><span className="detail-value">{viewRecord.created_by_name}</span></div>}
                {viewRecord.remark && <div className="detail-item detail-item-full"><span className="detail-label">Remark</span><span className="detail-value">{viewRecord.remark}</span></div>}
              </div>
              <div className="procurement-card">
                <strong>Items</strong>
                <table className="procurement-items-table">
                  <thead><tr><th>Product</th><th>Quantity</th></tr></thead>
                  <tbody>
                    {(viewRecord.items || []).map((item) => (
                      <tr key={item.id}><td>{item.product_name || `Product #${item.product_id}`}</td><td>{formatNumber(item.quantity)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </MasterModal>
      ) : null}
    </div>
  );
};

// ─────────────────────────── Stock Adjustments ───────────────────────────

const emptyAdjustmentForm = () => ({
  adjustment_number: '',
  warehouse_id: '',
  date: today(),
  reason: '',
  items: [{ product_id: '', quantity: '1', type: 'manual' }],
});

const StockAdjustmentsTab = ({ token, onLogout, warehouses, productOptions, menuRef, menuOpenId, setMenuOpenId, setPageSuccess, setPageError }) => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('id-desc');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState(emptyAdjustmentForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [viewRecord, setViewRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchStockAdjustments(token, { page, limit: pageSize, search, sortBy: sort.split('-')[0], order: sort.split('-')[1].toUpperCase() });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load stock adjustments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, search, sort]);

  const updateItem = (index, key, value) => {
    setFormValues((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [key]: value };
      return { ...prev, items };
    });
  };
  const addItem = () => setFormValues((prev) => ({ ...prev, items: [...prev.items, { product_id: '', quantity: '1', type: 'manual' }] }));
  const removeItem = (index) => setFormValues((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));

  const openCreate = () => {
    setFormValues(emptyAdjustmentForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); load(); };

  const submitForm = async () => {
    const errors = {};
    if (!formValues.warehouse_id) errors.warehouse_id = 'Warehouse is required.';
    formValues.items.forEach((item, index) => {
      if (!item.product_id) errors[`item-product-${index}`] = 'Product is required.';
      if (!item.quantity || Number(item.quantity) === 0) errors[`item-quantity-${index}`] = 'Quantity must not be zero.';
    });
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await createStockAdjustment(token, {
        adjustment_number: formValues.adjustment_number || `ADJ-${Date.now()}`,
        warehouse_id: Number(formValues.warehouse_id),
        date: formValues.date || new Date().toISOString().slice(0, 10),
        reason: formValues.reason,
        items: formValues.items.map((item) => ({ product_id: Number(item.product_id), quantity: Number(item.quantity), type: item.type })),
      });
      setPageSuccess('Stock adjustment created.');
      setFormOpen(false);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setFormErrors({ submit: error.message || 'Unable to save adjustment.' });
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (row) => {
    setMenuOpenId(null);
    setViewRecord(row);
    setViewLoading(true);
    try {
      const data = await fetchStockAdjustmentById(token, row.id);
      setViewRecord(data);
    } catch (error) {
      if (error.status === 401) return onLogout();
      setPageError(error.message || 'Unable to load adjustment details');
    } finally {
      setViewLoading(false);
    }
  };

  const columns = [
    { key: 'adjustment_number', label: 'Adjustment Number', sortable: true },
    { key: 'warehouse_name', label: 'Warehouse' },
    { key: 'date', label: 'Date' },
    { key: 'reason', label: 'Reason' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'date') return formatDate(row.date);
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => (
    <div className="dropdown-menu-list">
      <button type="button" className="dropdown-menu-item" onClick={() => handleView(row)}><EyeIcon className="menu-icon" /><span>View</span></button>
    </div>
  );

  return (
    <div className="procurement-shell">
      {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}
      <div className="procurement-toolbar">
        <SearchToolbar
          searchValue={search}
          onSearchValueChange={setSearch}
          onSubmit={() => setPage(1)}
          onReset={() => { setSearch(''); setPage(1); }}
          sortValue={sort}
          onSortChange={setSort}
          sortOptions={[
            { label: 'Newest first', value: 'id-desc' },
            { label: 'Oldest first', value: 'id-asc' },
            { label: 'Adjustment Number A-Z', value: 'adjustment_number-asc' },
            { label: 'Adjustment Number Z-A', value: 'adjustment_number-desc' },
          ]}
          extraActions={<button type="button" className="master-button master-button-secondary" onClick={load} title="Refresh"><RefreshIcon className="button-icon" /><span>Refresh</span></button>}
        />
        <div className="procurement-actions">
          <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>New Stock Adjustment</AppButton>
        </div>
      </div>

      <div className="procurement-card">
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowActions={[]}
          onEdit={() => {}}
          onDelete={() => {}}
          renderRowActions={renderActions}
          menuOpenId={menuOpenId}
          onToggleMenu={setMenuOpenId}
          menuRef={menuRef}
          emptyState={<EmptyState title="No stock adjustments yet" description="Record a discrepancy to get started." actionLabel="New Stock Adjustment" onAction={openCreate} />}
          renderCell={renderCell}
        />
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
      </div>

      {formOpen ? (
        <MasterModal
          size="wide"
          title="New Stock Adjustment"
          description="Positive quantities increase stock, negative quantities decrease it."
          onClose={closeForm}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
            <div className="procurement-grid">
              <div className="form-field">
                <label>Adjustment Number</label>
                <input type="text" value={formValues.adjustment_number} placeholder={`ADJ-${Date.now()}`} onChange={(e) => setFormValues((p) => ({ ...p, adjustment_number: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>Date</label>
                <input type="date" value={formValues.date} onChange={(e) => setFormValues((p) => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>Warehouse *</label>
                <select value={formValues.warehouse_id} onChange={(e) => setFormValues((p) => ({ ...p, warehouse_id: e.target.value }))}>
                  <option value="">Select warehouse</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {formErrors.warehouse_id ? <div className="field-error">{formErrors.warehouse_id}</div> : null}
              </div>
              <div className="form-field form-field-full">
                <label>Reason</label>
                <input type="text" value={formValues.reason} onChange={(e) => setFormValues((p) => ({ ...p, reason: e.target.value }))} placeholder="Optional note" />
              </div>
            </div>

            <div className="procurement-card">
              <div className="procurement-toolbar">
                <strong>Items</strong>
                <AppButton variant="secondary" onClick={addItem}>Add Item</AppButton>
              </div>
              <table className="procurement-items-table">
                <thead><tr><th>Product</th><th>Quantity (+/-)</th><th>Type</th><th></th></tr></thead>
                <tbody>
                  {formValues.items.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <SearchableSelect
                          value={item.product_id}
                          onChange={(newValue) => updateItem(index, 'product_id', newValue)}
                          options={productOptions}
                          placeholder="Select product"
                          searchPlaceholder="Search products..."
                        />
                        {formErrors[`item-product-${index}`] ? <div className="field-error">{formErrors[`item-product-${index}`]}</div> : null}
                      </td>
                      <td><input type="number" step="0.01" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} placeholder="e.g. -5 or 5" /></td>
                      <td>
                        <select value={item.type} onChange={(e) => updateItem(index, 'type', e.target.value)}>
                          {ADJUSTMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <button type="button" className="item-remove-btn" onClick={() => removeItem(index)} title="Remove item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {viewRecord ? (
        <MasterModal
          size="wide"
          title={`Stock Adjustment: ${viewRecord.adjustment_number}`}
          description="View stock adjustment details"
          onClose={() => setViewRecord(null)}
          footer={<button type="button" className="master-button master-button-secondary" onClick={() => setViewRecord(null)}>Close</button>}
        >
          {viewLoading ? <div className="status-banner">Loading...</div> : (
            <div className="procurement-shell">
              <div className="detail-grid">
                <div className="detail-item"><span className="detail-label">Warehouse</span><span className="detail-value">{viewRecord.warehouse_name || '-'}</span></div>
                <div className="detail-item"><span className="detail-label">Date</span><span className="detail-value">{formatDate(viewRecord.date)}</span></div>
                {viewRecord.created_by_name && <div className="detail-item"><span className="detail-label">Created by</span><span className="detail-value">{viewRecord.created_by_name}</span></div>}
                {viewRecord.reason && <div className="detail-item detail-item-full"><span className="detail-label">Reason</span><span className="detail-value">{viewRecord.reason}</span></div>}
              </div>
              <div className="procurement-card">
                <strong>Items</strong>
                <table className="procurement-items-table">
                  <thead><tr><th>Product</th><th>Quantity</th><th>Type</th></tr></thead>
                  <tbody>
                    {(viewRecord.items || []).map((item) => (
                      <tr key={item.id}><td>{item.product_name || `Product #${item.product_id}`}</td><td>{formatNumber(item.quantity)}</td><td>{item.type || '-'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </MasterModal>
      ) : null}
    </div>
  );
};

// ─────────────────────────── Stock Count ───────────────────────────

const StockCountTab = ({ token, onLogout, warehouses, setPageSuccess, setPageError }) => {
  const [warehouseId, setWarehouseId] = useState('');
  const [stockRows, setStockRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [remark, setRemark] = useState('');
  const [localError, setLocalError] = useState('');
  const [printSetups, setPrintSetups] = useState([]);
  const [printSetupId, setPrintSetupId] = useState('');
  const importInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetchPrintPageSetups(token)
      .then((setups) => {
        if (cancelled) return;
        setPrintSetups(setups);
      })
      .catch(() => {
        // openPrintList falls back to sane A4 defaults if this never resolves.
      });
    return () => { cancelled = true; };
  }, [token]);

  const defaultPrintSetup = printSetups.find((s) => s.is_default) || printSetups[0] || null;
  const chosenPrintSetup = printSetupId
    ? printSetups.find((s) => String(s.id) === String(printSetupId)) || defaultPrintSetup
    : defaultPrintSetup;

  const warehouseName = warehouses.find((w) => String(w.id) === String(warehouseId))?.name || '';

  const loadStock = async (id) => {
    if (!id) {
      setStockRows([]);
      setCounts({});
      return;
    }
    setLoading(true);
    setLocalError('');
    try {
      const data = await fetchWarehouseStock(token, id);
      setStockRows(data || []);
      setCounts({});
    } catch (error) {
      if (error.status === 401) return onLogout();
      setLocalError(error.message || 'Unable to load current stock');
    } finally {
      setLoading(false);
    }
  };

  const handleWarehouseChange = (value) => {
    setWarehouseId(value);
    loadStock(value);
  };

  const discrepancyCount = stockRows.filter((row) => {
    const entered = counts[row.product_id];
    return entered !== undefined && entered !== '' && Number(entered) !== Number(row.quantity);
  }).length;

  const submit = async () => {
    const enteredItems = stockRows
      .filter((row) => counts[row.product_id] !== undefined && counts[row.product_id] !== '')
      .map((row) => ({ product_id: row.product_id, physical_quantity: Number(counts[row.product_id]) }));

    if (enteredItems.length === 0) {
      setLocalError('Enter at least one physical count before submitting.');
      return;
    }

    setSaving(true);
    setLocalError('');
    try {
      const response = await submitStockCount(token, { warehouse_id: Number(warehouseId), counts: enteredItems, remark });
      setPageSuccess(response.message || 'Stock count submitted.');
      setRemark('');
      await loadStock(warehouseId);
    } catch (error) {
      if (error.status === 401) return onLogout();
      setPageError(error.message || 'Unable to submit stock count');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const headers = ['product_id', 'product_code', 'product_name', 'system_quantity', 'physical_quantity'];
    const rows = stockRows.map((row) => [row.product_id, row.product_code || '', row.product_name, row.quantity, '']);
    const safeWarehouseName = (warehouseName || 'warehouse').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadCsv(`stock-count-${safeWarehouseName}-${today()}.csv`, toCsv(headers, rows));
  };

  const handleImportFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const records = parseCsv(String(reader.result || ''));
        const stockRowIds = new Set(stockRows.map((row) => String(row.product_id)));
        const nextCounts = {};
        let matched = 0;
        let skipped = 0;

        records.forEach((record) => {
          const productId = record.product_id;
          const physicalQuantity = record.physical_quantity;
          if (!productId || physicalQuantity === undefined || physicalQuantity === '') return;
          if (!stockRowIds.has(String(productId))) { skipped += 1; return; }
          if (Number.isNaN(Number(physicalQuantity))) { skipped += 1; return; }
          nextCounts[productId] = physicalQuantity;
          matched += 1;
        });

        setCounts((prev) => ({ ...prev, ...nextCounts }));
        setLocalError('');
        setPageSuccess(
          skipped > 0
            ? `Imported ${matched} counted row(s); ${skipped} row(s) skipped (unknown product or invalid quantity).`
            : `Imported ${matched} counted row(s).`
        );
      } catch {
        setLocalError('Unable to read that file - make sure it is a CSV exported from this screen.');
      }
    };
    reader.readAsText(file);
  };

  const handlePrint = () => {
    const opened = openPrintList({
      documentTypeLabel: 'Stock Count Sheet',
      documentNumber: `SC-${warehouseName || 'WAREHOUSE'}-${today()}`,
      extraMeta: [
        { label: 'Warehouse', value: warehouseName },
        { label: 'Date', value: new Date().toLocaleDateString() },
        { label: 'Counted By', value: '' },
      ],
      columns: [
        { key: 'product_name', label: 'Product' },
        { key: 'product_code', label: 'Code' },
        { key: 'quantity', label: 'System Qty', align: 'right' },
        { key: 'physical_quantity', label: 'Physical Qty', align: 'right', blank: true },
        { key: 'difference', label: 'Difference', align: 'right', blank: true },
      ],
      rows: stockRows.map((row) => ({
        product_name: row.product_name,
        product_code: row.product_code || '-',
        quantity: formatNumber(row.quantity),
      })),
      pageSettings: toPageSettings(chosenPrintSetup),
    });

    if (!opened) {
      setLocalError('Popup blocked. Please allow popups for printing.');
    }
  };

  return (
    <div className="procurement-shell">
      <div className="procurement-grid">
        <div className="form-field">
          <label>Warehouse *</label>
          <select value={warehouseId} onChange={(e) => handleWarehouseChange(e.target.value)}>
            <option value="">Select a warehouse to count</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="form-field form-field-full">
          <label>Remark</label>
          <input type="text" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional note about this count session" />
        </div>
      </div>

      {localError ? <div className="status-banner status-banner-error">{localError}</div> : null}

      {warehouseId ? (
        <div className="procurement-card">
          <div className="procurement-toolbar">
            <strong>Physical Count</strong>
            <div className="procurement-actions">
              {discrepancyCount > 0 ? <StatusBadge value={`${discrepancyCount} ${discrepancyCount === 1 ? 'discrepancy' : 'discrepancies'}`} type="warning" /> : null}
              <button type="button" className="master-button master-button-secondary" onClick={handleExport} disabled={stockRows.length === 0} title="Export to CSV">
                <DownloadIcon className="button-icon" /><span>Export</span>
              </button>
              <button type="button" className="master-button master-button-secondary" onClick={() => importInputRef.current?.click()} disabled={stockRows.length === 0} title="Import counts from CSV">
                <UploadIcon className="button-icon" /><span>Import</span>
              </button>
              <input ref={importInputRef} type="file" accept=".csv" hidden onChange={handleImportFile} />
              {printSetups.length > 1 ? (
                <select
                  value={printSetupId || defaultPrintSetup?.id || ''}
                  onChange={(e) => setPrintSetupId(e.target.value)}
                  title="Page setup to print with"
                >
                  {printSetups.map((setup) => (
                    <option key={setup.id} value={setup.id}>{setup.name}{setup.is_default ? ' (Default)' : ''}</option>
                  ))}
                </select>
              ) : null}
              <button type="button" className="master-button master-button-secondary" onClick={handlePrint} disabled={stockRows.length === 0} title="Print count sheet">
                <PrinterIcon className="button-icon" /><span>Print</span>
              </button>
            </div>
          </div>
          {loading ? (
            <div className="status-banner">Loading current stock...</div>
          ) : stockRows.length === 0 ? (
            <EmptyState title="No active products" description="Add products before running a stock count." />
          ) : (
            <table className="procurement-items-table">
              <thead>
                <tr><th>Product</th><th>System Qty</th><th>Physical Qty</th><th>Difference</th></tr>
              </thead>
              <tbody>
                {stockRows.map((row) => {
                  const entered = counts[row.product_id];
                  const hasEntry = entered !== undefined && entered !== '';
                  const diff = hasEntry ? Number(entered) - Number(row.quantity) : null;
                  return (
                    <tr key={row.product_id}>
                      <td>{row.product_name}{row.product_code ? ` (${row.product_code})` : ''}</td>
                      <td>{formatNumber(row.quantity)}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          value={entered ?? ''}
                          placeholder={formatNumber(row.quantity)}
                          onChange={(e) => setCounts((prev) => ({ ...prev, [row.product_id]: e.target.value }))}
                        />
                      </td>
                      <td style={diff ? { color: diff > 0 ? 'var(--md-success)' : 'var(--md-danger)', fontWeight: 600 } : undefined}>{hasEntry ? formatNumber(diff) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <button type="button" className="master-button master-button-primary" onClick={submit} disabled={saving || stockRows.length === 0} style={{ marginTop: '16px' }}>
            {saving ? 'Submitting...' : 'Submit Stock Count'}
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default Inventory;
