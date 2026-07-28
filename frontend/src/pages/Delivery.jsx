import React, { useEffect, useRef, useState } from 'react';
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
  CheckIcon,
  XCircleIcon,
} from '../components/masterData/MasterDataPrimitives';
import {
  fetchDeliveries,
  createDelivery,
  updateDeliveryStatus,
  fetchSalesInvoices,
} from '../services/deliveryService';

const PAGE_SIZES = [5, 10, 20, 50];

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString();
};

const emptyForm = () => ({ delivery_number: '', invoice_id: '', date: '', vehicle_info: '', driver_name: '', remark: '' });

const NEXT_STATUS_ACTIONS = {
  pending: [{ status: 'shipped', label: 'Mark Shipped' }, { status: 'failed', label: 'Mark Failed' }],
  shipped: [{ status: 'delivered', label: 'Mark Delivered' }, { status: 'failed', label: 'Mark Failed' }],
};

const Delivery = ({ token, onLogout, embedded = false }) => {
  const [invoices, setInvoices] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date-desc');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState(emptyForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const loadInvoices = async () => {
      try {
        const response = await fetchSalesInvoices(token, { page: 1, limit: 1000, sortBy: 'id', order: 'DESC' });
        setInvoices(response.data || []);
      } catch {
        // ignore lookup errors for now
      }
    };
    loadInvoices();
  }, [token]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchDeliveries(token, { page, limit: pageSize, search, sortBy: sort.split('-')[0], order: sort.split('-')[1].toUpperCase() });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setListError(err.message || 'Unable to load deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, search, sort]);

  const openCreate = () => {
    setFormValues(emptyForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); load(); };

  const submitForm = async () => {
    const errors = {};
    if (!formValues.invoice_id) errors.invoice_id = 'Sales invoice is required.';
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await createDelivery(token, {
        delivery_number: formValues.delivery_number || `DEL-${Date.now()}`,
        invoice_id: Number(formValues.invoice_id),
        date: formValues.date || new Date().toISOString().slice(0, 10),
        vehicle_info: formValues.vehicle_info,
        driver_name: formValues.driver_name,
        remark: formValues.remark,
      });
      setSuccess('Delivery created.');
      setFormOpen(false);
      await load();
    } catch (err) {
      if (err.status === 401) return onLogout();
      setFormErrors({ submit: err.message || 'Unable to save delivery.' });
    } finally {
      setSaving(false);
    }
  };

  const handleAdvance = async (row, status) => {
    setMenuOpenId(null);
    try {
      await updateDeliveryStatus(token, row.id, { status, remark: row.remark });
      setSuccess(`Delivery marked ${status}.`);
      await load();
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to update delivery status');
    }
  };

  const columns = [
    { key: 'delivery_number', label: 'Delivery Number', sortable: true },
    { key: 'invoice_number', label: 'Invoice' },
    { key: 'date', label: 'Date', sortable: true },
    { key: 'vehicle_info', label: 'Vehicle' },
    { key: 'driver_name', label: 'Driver' },
    { key: 'status', label: 'Status' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'status') return <StatusBadge value={row.status} />;
    if (column.key === 'date') return formatDate(row.date);
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => {
    const nextActions = NEXT_STATUS_ACTIONS[row.status] || [];
    if (nextActions.length === 0) {
      return <div className="dropdown-menu-list"><span className="dropdown-menu-item" style={{ color: 'var(--md-muted)', cursor: 'default' }}>No actions available</span></div>;
    }
    return (
      <div className="dropdown-menu-list">
        {nextActions.map((action) => (
          <button
            key={action.status}
            type="button"
            className={`dropdown-menu-item ${action.status === 'failed' ? 'danger' : ''}`}
            onClick={() => handleAdvance(row, action.status)}
          >
            {action.status === 'failed' ? <XCircleIcon className="menu-icon" /> : <CheckIcon className="menu-icon" />}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    );
  };

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Sales', 'Delivery']} title="Delivery" description="Schedule deliveries and track vehicle, driver, and status." actions={null} /> : null}
      {success ? <div className="status-banner status-banner-success status-banner-autodismiss" style={{ marginBottom: '1rem' }}>{success}</div> : null}
      {error ? <div className="status-banner status-banner-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

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
              { label: 'Newest first', value: 'date-desc' },
              { label: 'Oldest first', value: 'date-asc' },
              { label: 'Delivery Number A-Z', value: 'delivery_number-asc' },
              { label: 'Delivery Number Z-A', value: 'delivery_number-desc' },
            ]}
            extraActions={<button type="button" className="master-button master-button-secondary" onClick={load} title="Refresh"><RefreshIcon className="button-icon" /><span>Refresh</span></button>}
          />
          <div className="procurement-actions">
            <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>New Delivery</AppButton>
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
            emptyState={<EmptyState title="No deliveries yet" description="Schedule a delivery to get started." actionLabel="New Delivery" onAction={openCreate} />}
            renderCell={renderCell}
          />
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
        </div>
      </div>

      {formOpen ? (
        <MasterModal
          title="New Delivery"
          description="Schedule a delivery for a sales invoice."
          onClose={closeForm}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          )}
        >
          <div className="modal-form">
            {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
            <div className="form-grid">
              <div className="form-field">
                <label>Delivery Number</label>
                <input type="text" value={formValues.delivery_number} placeholder={`DEL-${Date.now()}`} onChange={(e) => setFormValues((p) => ({ ...p, delivery_number: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>Date</label>
                <input type="date" value={formValues.date} onChange={(e) => setFormValues((p) => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="form-field form-field-full">
                <label>Sales Invoice *</label>
                <select value={formValues.invoice_id} onChange={(e) => setFormValues((p) => ({ ...p, invoice_id: e.target.value }))}>
                  <option value="">Select invoice</option>
                  {invoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.invoice_number} - {inv.customer_name}</option>)}
                </select>
                {formErrors.invoice_id ? <div className="field-error">{formErrors.invoice_id}</div> : null}
              </div>
              <div className="form-field">
                <label>Vehicle</label>
                <input type="text" value={formValues.vehicle_info} onChange={(e) => setFormValues((p) => ({ ...p, vehicle_info: e.target.value }))} placeholder="e.g. YGN-1234" />
              </div>
              <div className="form-field">
                <label>Driver</label>
                <input type="text" value={formValues.driver_name} onChange={(e) => setFormValues((p) => ({ ...p, driver_name: e.target.value }))} placeholder="Driver name" />
              </div>
              <div className="form-field form-field-full">
                <label>Remark</label>
                <input type="text" value={formValues.remark} onChange={(e) => setFormValues((p) => ({ ...p, remark: e.target.value }))} placeholder="Optional note" />
              </div>
            </div>
          </div>
        </MasterModal>
      ) : null}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default Delivery;
