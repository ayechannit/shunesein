import React, { useEffect, useRef, useState } from 'react';
import '../styles/Procurement.css';
import {
  AppButton,
  ConfirmDialog,
  DataTable,
  EmptyState,
  MasterModal,
  PageHeader,
  Pagination,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchToolbar,
  StatusBadge,
  TrashIcon,
  CheckIcon,
  XCircleIcon,
} from '../components/masterData/MasterDataPrimitives';
import {
  fetchDeliveries,
  createDelivery,
  updateDelivery,
  deleteDelivery,
  updateDeliveryStatus,
  fetchSalesInvoices,
} from '../services/deliveryService';
import { formatDate, todayLocal as today } from '../utils/datetime';

const PAGE_SIZES = [5, 10, 20, 50];

const emptyForm = () => ({ delivery_number: '', invoice_ids: [], date: today(), vehicle_info: '', driver_name: '', remark: '' });

const NEXT_STATUS_ACTIONS = {
  pending: [{ status: 'shipped', label: 'Mark Shipped' }, { status: 'failed', label: 'Mark Failed' }],
  shipped: [{ status: 'delivered', label: 'Mark Delivered' }, { status: 'failed', label: 'Mark Failed' }],
};

const Delivery = ({ token, onLogout, embedded = false, hasPermission = () => true }) => {
  const canWrite = hasPermission('manage_delivery');
  const canEdit = hasPermission('manage_delivery_edit');
  const canDelete = hasPermission('manage_delivery_delete');
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
  const [formMode, setFormMode] = useState('create');
  const [formValues, setFormValues] = useState(emptyForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [invoicePickerFilter, setInvoicePickerFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
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
    setFormMode('create');
    setFormValues(emptyForm());
    setFormErrors({});
    setInvoicePickerFilter('');
    setFormOpen(true);
  };

  const handleEdit = (row) => {
    setMenuOpenId(null);
    setFormMode('edit');
    setFormValues({
      id: row.id,
      delivery_number: row.delivery_number || '',
      invoice_ids: row.invoice_ids || [],
      date: row.date ? String(row.date).slice(0, 10) : today(),
      vehicle_info: row.vehicle_info || '',
      driver_name: row.driver_name || '',
      remark: row.remark || '',
    });
    setFormErrors({});
    setInvoicePickerFilter('');
    setFormOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError('');
    try {
      await deleteDelivery(token, deleteTarget.id);
      setSuccess('Delivery deleted.');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      if (err.status === 401) return onLogout();
      setDeleteError(err.message || 'Unable to delete delivery');
    } finally {
      setSaving(false);
    }
  };

  const closeForm = () => { setFormOpen(false); load(); };

  const toggleInvoice = (invoiceId) => {
    setFormValues((prev) => {
      const exists = prev.invoice_ids.includes(invoiceId);
      return {
        ...prev,
        invoice_ids: exists ? prev.invoice_ids.filter((id) => id !== invoiceId) : [...prev.invoice_ids, invoiceId],
      };
    });
  };

  const submitForm = async () => {
    const errors = {};
    if (!formValues.invoice_ids || formValues.invoice_ids.length === 0) {
      errors.invoice_ids = 'Select at least one sales invoice.';
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        delivery_number: formValues.delivery_number || `DEL-${Date.now()}`,
        invoice_ids: formValues.invoice_ids,
        date: formValues.date || new Date().toISOString().slice(0, 10),
        vehicle_info: formValues.vehicle_info,
        driver_name: formValues.driver_name,
        remark: formValues.remark,
      };
      if (formMode === 'edit') {
        await updateDelivery(token, formValues.id, payload);
        setSuccess('Delivery updated.');
      } else {
        await createDelivery(token, payload);
        setSuccess('Delivery created.');
      }
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
    { key: 'invoice_numbers', label: 'Invoices' },
    { key: 'date', label: 'Date', sortable: true },
    { key: 'vehicle_info', label: 'Vehicle' },
    { key: 'driver_name', label: 'Driver' },
    { key: 'status', label: 'Status' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'status') return <StatusBadge value={row.status} />;
    if (column.key === 'date') return formatDate(row.date);
    if (column.key === 'invoice_numbers') {
      const value = row.invoice_numbers || '';
      if (!value) return '-';
      return (
        <span
          title={value}
          style={{ display: 'inline-block', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
        >
          {value}
        </span>
      );
    }
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => {
    const isPending = row.status === 'pending';
    const nextActions = canWrite ? (NEXT_STATUS_ACTIONS[row.status] || []) : [];
    const hasEditOrDelete = (canEdit || canDelete) && isPending;
    if (nextActions.length === 0 && !hasEditOrDelete) {
      return <div className="dropdown-menu-list"><span className="dropdown-menu-item" style={{ color: 'var(--md-muted)', cursor: 'default' }}>No actions available</span></div>;
    }
    return (
      <div className="dropdown-menu-list">
        {canEdit && isPending && (
          <button type="button" className="dropdown-menu-item" onClick={() => handleEdit(row)}>
            <PencilIcon className="menu-icon" />
            <span>Edit</span>
          </button>
        )}
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
        {canDelete && isPending && (
          <button type="button" className="dropdown-menu-item danger" onClick={() => { setMenuOpenId(null); setDeleteTarget(row); }}>
            <TrashIcon className="menu-icon" />
            <span>Delete</span>
          </button>
        )}
      </div>
    );
  };

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Sales', 'Delivery']} title="Delivery" description="Schedule deliveries and track vehicle, driver, and status." actions={null} /> : null}
      {success ? (
        <div className="status-banner status-banner-success" style={{ marginBottom: '1rem' }}>
          <span>{success}</span>
          <button type="button" className="status-banner-close" aria-label="Dismiss" onClick={() => setSuccess('')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      ) : null}
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
            {canWrite ? (
              <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>New Delivery</AppButton>
            ) : null}
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
            emptyState={<EmptyState title="No deliveries yet" description="Schedule a delivery to get started." actionLabel={canWrite ? 'New Delivery' : undefined} onAction={canWrite ? openCreate : undefined} />}
            renderCell={renderCell}
          />
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
        </div>
      </div>

      {formOpen ? (
        <MasterModal
          title={formMode === 'edit' ? 'Edit Delivery' : 'New Delivery'}
          description="Schedule a delivery for a sales invoice."
          onClose={closeForm}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : (formMode === 'edit' ? 'Update' : 'Save')}</button>
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
                <label>Sales Invoices * {formValues.invoice_ids.length > 0 ? `(${formValues.invoice_ids.length} selected)` : ''}</label>
                <input
                  type="text"
                  className="picker-list-search"
                  value={invoicePickerFilter}
                  onChange={(e) => setInvoicePickerFilter(e.target.value)}
                  placeholder="Search invoice number or customer..."
                />
                <div className="picker-list">
                  {invoices
                    .filter((inv) => {
                      const term = invoicePickerFilter.trim().toLowerCase();
                      if (!term) return true;
                      return (
                        (inv.invoice_number || '').toLowerCase().includes(term) ||
                        (inv.customer_name || '').toLowerCase().includes(term)
                      );
                    })
                    .map((inv) => (
                      <label key={inv.id} className="picker-list-item">
                        <input
                          type="checkbox"
                          checked={formValues.invoice_ids.includes(inv.id)}
                          onChange={() => toggleInvoice(inv.id)}
                        />
                        <span>{inv.invoice_number} - {inv.customer_name || '-'}</span>
                      </label>
                    ))}
                  {invoices.length === 0 ? (
                    <div className="picker-list-empty">No sales invoices available.</div>
                  ) : null}
                </div>
                {formErrors.invoice_ids ? <div className="field-error">{formErrors.invoice_ids}</div> : null}
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

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete Delivery?"
          description={`Are you sure you want to delete ${deleteTarget.delivery_number}? This action cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          onConfirm={handleDeleteConfirm}
          loading={saving}
          error={deleteError}
        />
      ) : null}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default Delivery;
